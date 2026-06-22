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
import type { RegistryCorruptionError, SetupCommandFailedError } from "../domain/errors.js";
import { interpret } from "../domain/reducer.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { decodeRunStatus, type PhaseStatus, type RunStatus } from "../schemas/status.js";
import { dispatch } from "./dispatcher.js";
import { composePhaxState } from "./phaxState.js";
import { resolveRun } from "./resolveRunInfo.js";

export class ResetPhaseError extends Data.TaggedError("ResetPhaseError")<{
  readonly reason:
    | "run_not_found"
    | "phase_not_found"
    | "phase_blocked_by_later_committed"
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
}

const TERMINAL_COMMITTED_STATES = new Set<PhaseStatus["state"]>(["committed", "cleaned_up"]);

function archiveTimestamp(): string {
  // ISO timestamp with colons swapped for hyphens so it is a safe path segment.
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Reset a single phase so the run becomes resumable and the phase re-runs fresh.
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
    };
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
    const decoded = decodeRunStatus(parsed);
    if (Either.isLeft(decoded)) return;
    // Drop `lastError` from the already-validated on-disk shape. We don't go
    // through a status encoder here — the architectural guard reserves those
    // for the dispatcher and effect runner.
    const cleared: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    delete cleared.lastError;
    cleared.updatedAt = new Date().toISOString();
    yield* fs.writeAtomic(path, JSON.stringify(cleared, null, 2));
  });
}
