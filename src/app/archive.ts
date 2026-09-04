import { Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { FileSystem, FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Lock } from "../ports/lock.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  ArchiveRefusedError,
  RegistryCorruptionError,
  LockConflictError,
  SetupCommandFailedError,
} from "../domain/errors.js";
import type { RunId, ShortName, WorktreePath } from "../domain/branded.js";
import { resolveRun } from "./resolveRunInfo.js";
import { patchAgentBindingStatus } from "./agentBinding.js";
import { setRunStatus } from "./registry.js";
import { dispatch } from "./dispatcher.js";
import { runKey } from "../domain/runRef.js";

export interface ArchiveOptions {
  force?: boolean;
}

export function archive(
  namespace: string,
  shortName: ShortName,
  stateRoot: string,
  repoRoot: string,
  opts: ArchiveOptions,
): Effect.Effect<
  void,
  | FsError
  | GitError
  | ShellError
  | SetupCommandFailedError
  | RegistryCorruptionError
  | ArchiveBlockedByDirtyWorktreeError
  | ArchiveRefusedError
  | LockConflictError,
  FileSystem | Git | Shell | Lock | SystemTelemetry
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const lock = yield* Lock;

    // 1. Refuse when lock is active
    const qualifiedKey = runKey(namespace, shortName);
    const lockStatus = yield* lock.status(qualifiedKey);
    if (lockStatus.kind === "active") {
      return yield* Effect.fail(
        new LockConflictError({
          message: `Run "${qualifiedKey}" is locked by pid ${lockStatus.pid}. Release the lock first or use phax unlock.`,
          shortName: qualifiedKey,
          lockPath: join(stateRoot, "locks", `${qualifiedKey}.lock`),
          lockingPid: lockStatus.pid,
        }),
      );
    }

    // 2. Find the final worktree path from phase statuses
    const runPath = join(stateRoot, "runs", runKey(namespace, shortName));
    const infoResult = yield* Effect.sync(() => resolveRun(namespace, shortName, stateRoot));

    const worktreePath =
      Either.isRight(infoResult) && infoResult.right.worktreePath
        ? (infoResult.right.worktreePath as WorktreePath)
        : undefined;

    const runState = Either.isRight(infoResult) ? infoResult.right.runState : undefined;
    const finished = runState === "review_open" || runState === "completed";

    // 3. Check final worktree cleanliness (finished runs without --force only).
    //    An unfinished run never reaches this guard: the reducer rejects it before
    //    MoveRunToArchive is emitted, and --force bypasses cleanliness entirely.
    if (worktreePath && !opts.force && finished) {
      const worktreeExists = yield* fs.exists(worktreePath);
      if (worktreeExists) {
        const isClean = yield* git.worktreeIsClean(worktreePath);
        if (!isClean) {
          return yield* Effect.fail(
            new ArchiveBlockedByDirtyWorktreeError({
              message: `Worktree at "${worktreePath}" has uncommitted changes. Commit or stash changes, or use --force.`,
              worktreePath,
            }),
          );
        }
      }
    }

    // Patch each phase binding to 'archived' before the folder is moved.
    // No-op when a phase has no binding (patchAgentBindingStatus catches internally).
    if (Either.isRight(infoResult)) {
      for (const phaseStatus of infoResult.right.phaseStatuses) {
        const phaseFolderPath = join(runPath, phaseStatus.phaseId);
        yield* Effect.promise(() => patchAgentBindingStatus(phaseFolderPath, "archived"));
      }
    }

    // 4. Dispatch RunArchiveRequested. The reducer is the source of truth for
    //    which states allow archiving: review_open and completed always succeed;
    //    created, failed, interrupted, rate_limited, and stopped succeed only
    //    when force is set; running and archived are always refused. A non-Handled
    //    disposition surfaces as ArchiveRefusedError with the reducer's reason.
    //    On Handled, the reducer emits MoveRunToArchive effects and the dispatcher
    //    persists run-status.json.
    //
    //    Both the run folder and the worktrees folder land under a single
    //    umbrella so a user can move the entire archive entry as one unit and
    //    the archivePath registry field stays unambiguous.
    const archivePath = join(stateRoot, "archive", runKey(namespace, shortName));
    const runsTo = join(archivePath, "runs");
    const worktreesFrom = join(stateRoot, "worktrees", runKey(namespace, shortName));
    const worktreesTo = join(archivePath, "worktrees");

    // Only include the worktrees pair when the source directory exists.
    const worktreesDirExists = yield* fs.exists(worktreesFrom);

    const result = yield* dispatch(
      {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        run: shortName as unknown as RunId,
        type: "RunArchiveRequested",
        force: opts.force ?? false,
        from: runPath,
        to: runsTo,
        worktreesFrom: worktreesDirExists ? worktreesFrom : undefined,
        worktreesTo: worktreesDirExists ? worktreesTo : undefined,
      },
      { runPath, shortName: shortName as string },
    );
    if (result.disposition !== "Handled") {
      return yield* Effect.fail(
        new ArchiveRefusedError({
          message: `Run "${qualifiedKey}" ${result.reason ?? "cannot be archived"}.`,
          shortName: qualifiedKey,
          state: result.stateBefore.run,
        }),
      );
    }

    // 5. Prune git's stale worktree admin records. This is safe to call even
    //    if no worktrees were moved — git worktree prune is a no-op when
    //    nothing is stale.
    yield* git.pruneWorktrees(repoRoot).pipe(Effect.ignore);

    // 6. Update registry index (run-status.json is already written by the
    //    dispatcher above; this call only refreshes the central registry.json).
    //    archivePath points at the umbrella directory, not the runs subfolder.
    yield* setRunStatus(stateRoot, namespace, shortName as string, {
      state: "archived",
      archivePath,
    });
  });
}
