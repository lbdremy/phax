import { Data, Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  decodeBranchName,
  decodePhaseId,
  decodeWorktreePath,
  type RunId,
  type ShortName,
} from "../domain/branded.js";
import type {
  LockConflictError,
  RegistryCorruptionError,
  SetupCommandFailedError,
} from "../domain/errors.js";
import type { ChangedPath } from "../domain/interactive/worktreeChange.js";
import { interpret } from "../domain/reducer.js";
import { runKey } from "../domain/runRef.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import type { Lock } from "../ports/lock.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { readPhaxPlanFile, readRunStatusFile, withSchemaUrl } from "../schemas/persisted.js";
import { oracleRoleOf } from "../domain/plan/oraclePairs.js";
import type { PhaseStatus, RunStatus } from "../schemas/status.js";
import { dispatch } from "./dispatcher.js";
import { withRunLock } from "./lock.js";
import { composePhaxState } from "./phaxState.js";
import { resolveRun } from "./resolveRunInfo.js";

export class ResetPhaseError extends Data.TaggedError("ResetPhaseError")<{
  readonly reason:
    | "run_not_found"
    | "phase_not_found"
    | "phase_blocked_by_discharge"
    | "phase_blocked_by_later_committed"
    | "phase_not_at_stop"
    | "not_resettable";
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
}

const TERMINAL_COMMITTED_STATES = new Set<PhaseStatus["state"]>(["committed", "cleaned_up"]);

// A discharge the next resume restarts at, so `--skip-oracle` reaches its oracle step.
const STOPPED_AT_GATE_STATES = new Set<PhaseStatus["state"]>([
  "gates_exhausted",
  "gates_failed",
  "failed",
]);

/** The phase a run in `awaiting_review` waits at; undefined for any other run. */
function stoppedPhaseOf(info: {
  readonly runState: string;
  readonly phaseStatuses: readonly PhaseStatus[];
}): PhaseStatus | undefined {
  if (info.runState !== "awaiting_review") return undefined;
  return info.phaseStatuses
    .filter((p) => p.state === "awaiting_review")
    .toSorted((a, b) => b.phaseIndex - a.phaseIndex)[0];
}

// While a run awaits review, only the stopped phase can be reset: an earlier
// phase is committed work the stop sits on, and a later one has not started.
function checkTargetAtStop(
  shortName: string,
  target: PhaseStatus,
  stopped: PhaseStatus | undefined,
): ResetPhaseError | undefined {
  if (stopped === undefined || target.phaseId === stopped.phaseId) return undefined;
  const why =
    target.phaseIndex < stopped.phaseIndex
      ? `Reset "${stopped.phaseId}" first (\`phax reset-phase ${shortName} ${stopped.phaseId}\`).`
      : `"${target.phaseId}" has not started.`;
  return new ResetPhaseError({
    reason: "phase_not_at_stop",
    message: `Cannot reset "${target.phaseId}" of run "${shortName}": the run is awaiting review at "${stopped.phaseId}". ${why}`,
  });
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
    const notAtStop = checkTargetAtStop(opts.shortName, target, stopped);
    if (notAtStop !== undefined) return yield* Effect.fail(notAtStop);

    // An oracle phase is not reset once its discharge has started: the
    // discharge judges this phase's commit, which a reset would discard. A
    // committed oracle phase is never resettable anyway.
    const discharging = yield* dischargingPhaseOf(info.runPath, target.phaseId);
    const dischargingStatus = info.phaseStatuses.find((p) => p.phaseId === discharging);
    if (dischargingStatus !== undefined && dischargingStatus.state !== "pending") {
      return yield* Effect.fail(
        new ResetPhaseError({
          reason: "phase_blocked_by_discharge",
          // The skip recovery applies only while the discharge is the stopped
          // phase: a resume skips the oracle step of the phase it restarts at.
          message:
            `Cannot reset "${target.phaseId}" of run "${opts.shortName}": its discharging phase "${dischargingStatus.phaseId}" is ${dischargingStatus.state}, and a committed oracle phase is not reset.` +
            (STOPPED_AT_GATE_STATES.has(dischargingStatus.state)
              ? ` To correct the oracle, edit it in ${dischargingStatus.phaseId} (\`phax enter-phase ${opts.shortName} ${dischargingStatus.phaseId}\`), then run \`phax resume ${opts.shortName} --yes --skip-oracle\`: the configured gate still runs.`
              : ""),
        }),
      );
    }

    const laterCommitted = info.phaseStatuses.find(
      (p) => p.phaseIndex > target.phaseIndex && TERMINAL_COMMITTED_STATES.has(p.state),
    );
    if (laterCommitted !== undefined) {
      return yield* Effect.fail(
        new ResetPhaseError({
          reason: "phase_blocked_by_later_committed",
          message: `Cannot reset "${target.phaseId}" of run "${opts.shortName}": later phase "${laterCommitted.phaseId}" is already ${laterCommitted.state}.`,
        }),
      );
    }

    const phaseFolderPath = join(info.runPath, target.phaseId);
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

    const state = composePhaxState(info.runState as RunStatus["state"], info.lastError, target);
    const disposition = interpret(state, {
      type: "PhaseResetRequested",
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      run: info.runId as unknown as RunId,
      phaseId,
    });
    if (disposition.kind !== "Handled") {
      return yield* Effect.fail(
        new ResetPhaseError({
          reason: "not_resettable",
          message: `Cannot reset phase "${target.phaseId}" of run "${opts.shortName}": ${disposition.reason ?? "current state does not allow reset"}.`,
        }),
      );
    }

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
 * worktree (the worktree as it stands against HEAD's tree). The same refusals
 * as the reset apply to a phase that is not the stopped one.
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
    const notAtStop = checkTargetAtStop(opts.shortName, target, stopped);
    if (notAtStop !== undefined) return yield* Effect.fail(notAtStop);
    if (stopped === undefined) return { phaseId: target.phaseId, atStop: false, corrections: [] };

    const worktree = target.worktreePath;
    if (worktree === undefined || !(yield* fs.exists(worktree))) {
      return { phaseId: target.phaseId, atStop: true, corrections: [] };
    }
    const head = yield* git.headTree(worktree);
    const snapshot = yield* git.snapshotWorktree(worktree);
    const corrections =
      snapshot === head ? [] : yield* git.changedPathsBetween(worktree, head, snapshot);
    return { phaseId: target.phaseId, atStop: true, corrections };
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
 * The phase that discharges `phaseId` when it is an oracle phase, read from the
 * run's `phax-plan.json` in any shape; undefined otherwise. An unreadable plan
 * names none: such a run cannot resume anyway.
 */
function dischargingPhaseOf(
  runPath: string,
  phaseId: string,
): Effect.Effect<string | undefined, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(runPath, "phax-plan.json");
    const raw = yield* fs.readText(path);
    const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown);
    const read = readPhaxPlanFile(path, parsed);
    if (Either.isLeft(read)) return undefined;
    const role = oracleRoleOf(read.right.plan.phases, phaseId);
    return role?.role === "oracle" ? role.pair.dischargingPhase : undefined;
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
