import { Effect, Either } from "effect";
import { join } from "node:path";
import { FileSystem, FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Lock } from "../ports/lock.js";
import { decodeRunStatus } from "../schemas/status.js";
import { archiveRun as transitionToArchived } from "../domain/state.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  RegistryCorruptionError,
  LockConflictError,
} from "../domain/errors.js";
import type { ShortName, WorktreePath } from "../domain/branded.js";
import { resolveRunByShortName } from "./resolveRunInfo.js";
import { setRunStatus } from "./registry.js";

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
  | RegistryCorruptionError
  | ArchiveBlockedByDirtyWorktreeError
  | LockConflictError,
  FileSystem | Git | Lock
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

    // 2. Refuse unless run is review_open or completed
    const runPath = join(stateRoot, "runs", shortName);
    const runStatusPath = join(runPath, "run-status.json");
    const rawText = yield* fs.readText(runStatusPath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      return yield* Effect.fail(
        new FsError({ message: `Failed to parse run-status.json at "${runStatusPath}"` }),
      );
    }
    const decoded = decodeRunStatus(parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new FsError({ message: `Invalid run-status.json at "${runStatusPath}"` }),
      );
    }
    const runStatus = decoded.right;
    const stateTransition = transitionToArchived(runStatus.state);
    if (Either.isLeft(stateTransition)) {
      return yield* Effect.fail(
        new FsError({
          message: `Cannot archive run "${shortName}" in state "${runStatus.state}". Run must be review_open or completed.`,
        }),
      );
    }

    // 3. Find the final worktree path from phase statuses
    const infoResult = yield* Effect.sync(() => resolveRunByShortName(shortName, stateRoot));
    const worktreePath =
      Either.isRight(infoResult) && infoResult.right.worktreePath
        ? (infoResult.right.worktreePath as WorktreePath)
        : undefined;

    // 4. Check final worktree cleanliness
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

    // 5. Move runs/<short-name> → archive/<short-name>
    const archivePath = join(stateRoot, "archive", shortName);
    yield* fs.mkdirp(join(stateRoot, "archive"));
    yield* fs.rename(runPath, archivePath);

    // 6. Remove the final worktree only if clean (or if force)
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

    // 7. Update registry
    yield* setRunStatus(stateRoot, shortName, {
      state: "archived",
      archivePath,
    });
  });
}
