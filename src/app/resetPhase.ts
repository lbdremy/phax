import { Data, Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  decodeBranchName,
  decodePhaseId,
  decodeWorktreePath,
  type PhaseId,
  type RunId,
  type ShortName,
} from "../domain/branded.js";
import type {
  LockConflictError,
  RegistryCorruptionError,
  SetupCommandFailedError,
} from "../domain/errors.js";
import { PERSON_HANDOFF_PATH, type ChangedPath } from "../domain/interactive/worktreeChange.js";
import {
  resetPhaseRefusal,
  stoppedPhaseOf,
  TERMINAL_COMMITTED_STATES,
  type ResetRefusalReason,
} from "../domain/resetPhaseRefusal.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import { runKey } from "../domain/runRef.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { Lock } from "../ports/lock.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import {
  readPhaxPlanFile,
  readRunStatusFile,
  withSchemaUrl,
  type AnyShapePhaxPlan,
} from "../schemas/persisted.js";
import type { PhaseStatus, RunStatus } from "../schemas/status.js";
import { dispatch } from "./dispatcher.js";
import { withRunLock } from "./lock.js";
import { composePhaxState } from "./phaxState.js";
import { resolveRun } from "./resolveRunInfo.js";

export class ResetPhaseError extends Data.TaggedError("ResetPhaseError")<{
  readonly reason: "run_not_found" | "phase_not_found" | ResetRefusalReason;
  readonly message: string;
}> {}

export interface ResetPhaseOptions {
  readonly namespace: string;
  readonly shortName: ShortName;
  readonly phaseId?: string | undefined;
  readonly stateRoot: string;
  readonly repoRoot: string;
}

export interface ResetPhaseResult {
  readonly shortName: string;
  readonly phaseId: string;
  readonly archivedPath: string | undefined;
  readonly worktreeRemoved: boolean;
  readonly branchDeleted: boolean;
  /** True when the phase was the stopped phase of a run awaiting review. */
  readonly wasStopped: boolean;
}

/** What a reset of the phase would discard, for the preview printed without `--yes`. */
export interface ResetPreview {
  readonly phaseId: string;
  /** True when the phase is the stopped phase of a run awaiting review. */
  readonly atStop: boolean;
  /** The uncommitted corrections in the stopped phase's worktree; empty away from a stop. */
  readonly corrections: readonly ChangedPath[];
  /**
   * The person's handoff file in the stopped phase's worktree, which no
   * snapshot sees, when it exists; null when it does not or away from a stop.
   */
  readonly personHandoff: string | null;
  /**
   * The commit a reset discards: the stopped phase's own commit at a held
   * stop (a headless phase), null at a declared stop or away from one.
   */
  readonly phaseCommit: string | null;
  /** The stopped phase's worktree; null away from a stop. */
  readonly worktree: string | null;
}

function archiveTimestamp(): string {
  // ISO timestamp with colons swapped for hyphens so it is a safe path segment.
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Reset a single phase so the run becomes resumable and the phase re-runs fresh.
 *
 * It holds the run lock from its first read to its last write, as a run, a
 * resume and `phax enter-phase --new-session` do, so it never removes a
 * worktree a turn is running in; a held lock fails with the lock conflict and
 * nothing changes.
 *
 * Order of effects: dispatch first to update on-disk status while the phase
 * folder still exists, then archive the folder, remove the worktree, delete the
 * branch, and finally clear `lastError` from run-status.json (the reducer patch
 * only sets `stoppedReason`).
 */
export function resetPhase(
  opts: ResetPhaseOptions,
): Effect.Effect<
  ResetPhaseResult,
  | ResetPhaseError
  | LockConflictError
  | FsError
  | GitError
  | ShellError
  | SetupCommandFailedError
  | RegistryCorruptionError,
  FileSystem | Git | Lock | Shell | SystemTelemetry
> {
  return withRunLock(runKey(opts.namespace, opts.shortName), resetPhaseLocked(opts));
}

function resetPhaseLocked(
  opts: ResetPhaseOptions,
): Effect.Effect<
  ResetPhaseResult,
  | ResetPhaseError
  | FsError
  | GitError
  | ShellError
  | SetupCommandFailedError
  | RegistryCorruptionError,
  FileSystem | Git | Shell | SystemTelemetry
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;

    const infoResult = resolveRun(opts.namespace, opts.shortName, opts.stateRoot);
    if (Either.isLeft(infoResult)) {
      return yield* Effect.fail(
        new ResetPhaseError({
          reason: "run_not_found",
          message: `Run "${opts.shortName}" not found: ${infoResult.left}`,
        }),
      );
    }
    const info = infoResult.right;

    const target = selectTargetPhase(info.phaseStatuses, opts.phaseId);
    if (target === undefined) {
      const msg =
        opts.phaseId !== undefined
          ? `Phase "${opts.phaseId}" not found in run "${opts.shortName}"`
          : `Run "${opts.shortName}" has no resettable phase`;
      return yield* Effect.fail(new ResetPhaseError({ reason: "phase_not_found", message: msg }));
    }

    const stopped = stoppedPhaseOf(info);
    const phaseId = yield* checkResettable(opts, info, target);
    const phaseFolderPath = join(info.runPath, target.phaseId);

    // 1) Dispatch first so the reducer can read/write the phase status file
    //    while the phase folder still exists on disk.
    yield* dispatch(
      {
        type: "PhaseResetRequested",
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        run: info.runId as unknown as RunId,
        phaseId,
      },
      {
        runPath: info.runPath,
        shortName: opts.shortName,
        phaseFolderPath,
        phaseId: target.phaseId,
      },
    );

    // 2) Archive the phase folder (tolerant of an already-absent folder).
    let archivedPath: string | undefined;
    const folderExists = yield* fs.exists(phaseFolderPath);
    if (folderExists) {
      archivedPath = `${phaseFolderPath}.reset-${archiveTimestamp()}`;
      yield* fs.rename(phaseFolderPath, archivedPath);
    }

    // 3) Remove the worktree if one was recorded, tolerant of already-absent.
    let worktreeRemoved = false;
    if (target.worktreePath !== undefined) {
      const wtPathResult = decodeWorktreePath(target.worktreePath);
      if (Either.isRight(wtPathResult)) {
        const wtResult = yield* Effect.either(
          git.removeWorktree(wtPathResult.right, true, opts.repoRoot),
        );
        worktreeRemoved = Either.isRight(wtResult);
      }
    }

    // 4) Delete the phase branch, tolerant of an already-missing branch.
    let branchDeleted = false;
    const branchResult = decodeBranchName(target.branchName);
    if (Either.isRight(branchResult)) {
      const branch = branchResult.right;
      const exists = yield* git
        .branchExists(branch, opts.repoRoot)
        .pipe(Effect.catchAll(() => Effect.succeed(false)));
      if (exists) {
        const deleteResult = yield* Effect.either(git.deleteBranch(branch, true, opts.repoRoot));
        branchDeleted = Either.isRight(deleteResult);
      }
    }

    // 5) Clear lastError from run-status.json — the reducer's PersistState patch
    //    only sets stoppedReason; an exactOptionalPropertyTypes Partial cannot
    //    unset an optional field, so we rewrite the file here.
    yield* clearRunStatusLastError(info.runPath);

    return {
      shortName: opts.shortName,
      phaseId: target.phaseId,
      archivedPath,
      worktreeRemoved,
      branchDeleted,
      wasStopped: stopped !== undefined,
    };
  });
}

/**
 * What `resetPhase` would discard, without changing anything: at the stopped
 * phase of a run awaiting review, every uncommitted correction in its
 * worktree (the worktree as it stands against HEAD's tree) and the person's
 * handoff file, which the snapshot leaves out with `.phax-context/`. It runs
 * every refusal of the run's state that the reset runs, with the same reason
 * and message. It takes no lock; the reset runs the check again under the lock.
 */
export function previewResetPhase(
  opts: ResetPhaseOptions,
): Effect.Effect<ResetPreview, ResetPhaseError | FsError | GitError, FileSystem | Git> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;

    const infoResult = resolveRun(opts.namespace, opts.shortName, opts.stateRoot);
    if (Either.isLeft(infoResult)) {
      return yield* Effect.fail(
        new ResetPhaseError({
          reason: "run_not_found",
          message: `Run "${opts.shortName}" not found: ${infoResult.left}`,
        }),
      );
    }
    const info = infoResult.right;
    const target = selectTargetPhase(info.phaseStatuses, opts.phaseId);
    if (target === undefined) {
      const msg =
        opts.phaseId !== undefined
          ? `Phase "${opts.phaseId}" not found in run "${opts.shortName}"`
          : `Run "${opts.shortName}" has no resettable phase`;
      return yield* Effect.fail(new ResetPhaseError({ reason: "phase_not_found", message: msg }));
    }
    const stopped = stoppedPhaseOf(info);
    yield* checkResettable(opts, info, target);
    if (stopped === undefined) {
      return {
        phaseId: target.phaseId,
        atStop: false,
        corrections: [],
        personHandoff: null,
        phaseCommit: null,
        worktree: null,
      };
    }

    const phaseCommit = target.mode === "headless" ? (target.commitHash ?? null) : null;
    const worktree = target.worktreePath;
    if (worktree === undefined || !(yield* fs.exists(worktree))) {
      return {
        phaseId: target.phaseId,
        atStop: true,
        corrections: [],
        personHandoff: null,
        phaseCommit,
        worktree: worktree ?? null,
      };
    }
    const head = yield* git.headTree(worktree);
    const snapshot = yield* git.snapshotWorktree(worktree);
    const corrections =
      snapshot === head ? [] : yield* git.changedPathsBetween(worktree, head, snapshot);
    const handoffPath = join(worktree, PERSON_HANDOFF_PATH);
    const personHandoff = (yield* fs.exists(handoffPath)) ? handoffPath : null;
    return {
      phaseId: target.phaseId,
      atStop: true,
      corrections,
      personHandoff,
      phaseCommit,
      worktree,
    };
  });
}

/**
 * The refusals of the run's state, shared by the reset and its preview: the
 * phase id is decoded, the state composed and the reset event built, then the
 * pure check decides. Returns the decoded phase id.
 */
function checkResettable(
  opts: ResetPhaseOptions,
  info: RunReviewInfo,
  target: PhaseStatus,
): Effect.Effect<PhaseId, ResetPhaseError, FileSystem> {
  return Effect.gen(function* () {
    const phaseIdResult = decodePhaseId(target.phaseId);
    if (Either.isLeft(phaseIdResult)) {
      return yield* Effect.fail(
        new ResetPhaseError({
          reason: "phase_not_found",
          message: `Invalid phase id "${target.phaseId}"`,
        }),
      );
    }
    const phaseId = phaseIdResult.right;
    const refusal = resetPhaseRefusal({
      shortName: opts.shortName,
      runState: info.runState,
      target,
      phaseStatuses: info.phaseStatuses,
      planPhases: yield* readPlanPhases(info.runPath),
      state: () => composePhaxState(info.runState as RunStatus["state"], info.lastError, target),
      event: {
        type: "PhaseResetRequested",
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        run: info.runId as unknown as RunId,
        phaseId,
      },
    });
    if (refusal !== null) return yield* Effect.fail(new ResetPhaseError(refusal));
    return phaseId;
  });
}

function selectTargetPhase(
  phaseStatuses: readonly PhaseStatus[],
  explicitId: string | undefined,
): PhaseStatus | undefined {
  if (explicitId !== undefined) {
    return phaseStatuses.find((p) => p.phaseId === explicitId);
  }
  // Pick the highest-index non-committed/cleaned-up phase.
  return phaseStatuses
    .filter((p) => !TERMINAL_COMMITTED_STATES.has(p.state))
    .toSorted((a, b) => b.phaseIndex - a.phaseIndex)[0];
}

/**
 * The phases of the run's `phax-plan.json` in any shape, from which the
 * oracle pairs come; undefined when it is unreadable, which names no pair:
 * such a run cannot resume anyway.
 */
function readPlanPhases(
  runPath: string,
): Effect.Effect<AnyShapePhaxPlan["phases"] | undefined, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(runPath, "phax-plan.json");
    const raw = yield* fs.readText(path);
    const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown);
    const read = readPhaxPlanFile(path, parsed);
    return Either.isLeft(read) ? undefined : read.right.plan.phases;
  }).pipe(Effect.orElseSucceed(() => undefined));
}

function clearRunStatusLastError(runPath: string): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(runPath, "run-status.json");
    const exists = yield* fs.exists(path);
    if (!exists) return;
    const raw = yield* fs.readText(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    const decoded = readRunStatusFile(path, parsed);
    if (Either.isLeft(decoded)) return;
    // Drop `lastError` from the bridge-read status and stamp `$schema`. We don't
    // go through a status encoder here — the architectural guard reserves those
    // for the dispatcher and effect runner.
    const { lastError: _lastError, ...cleared } = decoded.right;
    const updated: RunStatus = { ...cleared, updatedAt: new Date().toISOString() };
    yield* fs.writeAtomic(path, JSON.stringify(withSchemaUrl("run-status", updated), null, 2));
  });
}
