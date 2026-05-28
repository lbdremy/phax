import { Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { FileSystem, FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Lock } from "../ports/lock.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { Tracer } from "../ports/tracer.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  InvalidTransitionError,
  RegistryCorruptionError,
  LockConflictError,
  SetupCommandFailedError,
} from "../domain/errors.js";
import type { RunId, ShortName, WorktreePath } from "../domain/branded.js";
import { resolveRunByShortName } from "./resolveRunInfo.js";
import { setRunStatus } from "./registry.js";
import { dispatch } from "./dispatcher.js";

export interface ArchiveOptions {
  force?: boolean;
}

export function archive(
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
  | InvalidTransitionError
  | LockConflictError,
  FileSystem | Git | Shell | Lock | Tracer | SystemTelemetry
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;
    const lock = yield* Lock;

    // 1. Refuse when lock is active
    const lockStatus = yield* lock.status(shortName);
    if (lockStatus.kind === "active") {
      return yield* Effect.fail(
        new LockConflictError({
          message: `Run "${shortName}" is locked by pid ${lockStatus.pid}. Release the lock first or use phax unlock.`,
          shortName,
          lockPath: join(stateRoot, "locks", `${shortName}.lock`),
          lockingPid: lockStatus.pid,
        }),
      );
    }

    // 2. Find the final worktree path from phase statuses
    const runPath = join(stateRoot, "runs", shortName);
    const infoResult = yield* Effect.sync(() => resolveRunByShortName(shortName, stateRoot));
    const worktreePath =
      Either.isRight(infoResult) && infoResult.right.worktreePath
        ? (infoResult.right.worktreePath as WorktreePath)
        : undefined;

    // 3. Check final worktree cleanliness
    if (worktreePath) {
      const worktreeExists = yield* fs.exists(worktreePath);
      if (worktreeExists) {
        const isClean = yield* git.worktreeIsClean(worktreePath);
        if (!isClean && !opts.force) {
          return yield* Effect.fail(
            new ArchiveBlockedByDirtyWorktreeError({
              message: `Worktree at "${worktreePath}" has uncommitted changes. Commit or stash changes, or use --force.`,
              worktreePath,
            }),
          );
        }
      }
    }

    // 4. Dispatch RunArchiveRequested. The reducer is the source of truth for
    //    which run states allow archiving (review_open and completed); any
    //    other state comes back as a Rejected disposition and we surface that
    //    as an InvalidTransitionError. On Handled, the reducer emits
    //    MoveRunToArchive and the dispatcher persists run-status.json.
    const archivePath = join(stateRoot, "archive", shortName);
    const result = yield* dispatch(
      {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        run: shortName as unknown as RunId,
        type: "RunArchiveRequested",
        from: runPath,
        to: archivePath,
      },
      { runPath, shortName: shortName as string },
    );
    if (result.disposition !== "Handled") {
      return yield* Effect.fail(
        new InvalidTransitionError({
          from: result.stateBefore.run,
          to: "archived",
          entity: "run",
        }),
      );
    }

    // 5. Remove the final worktree only if clean (or if force)
    if (worktreePath) {
      const worktreeExists = yield* fs.exists(worktreePath);
      if (worktreeExists) {
        const isClean = yield* git
          .worktreeIsClean(worktreePath)
          .pipe(Effect.orElseSucceed(() => false));
        if (isClean || opts.force) {
          yield* git
            .removeWorktree(worktreePath, opts.force ?? false, repoRoot)
            .pipe(Effect.ignore);
        }
      }
    }

    // 6. Update registry index (run-status.json is already written by the
    //    dispatcher above; this call only refreshes the central registry.json).
    yield* setRunStatus(stateRoot, shortName, {
      state: "archived",
      archivePath,
    });
  });
}
