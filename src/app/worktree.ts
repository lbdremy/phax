import { Effect, Either } from "effect";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Git } from "../ports/git.js";
import type { BranchName, PhaseId, ShortName, WorktreePath } from "../domain/branded.js";
import { decodeBranchName, decodeWorktreePath } from "../domain/branded.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  UnsafeGitStateError,
  WorktreeCreationError,
} from "../domain/errors.js";
import type { GitError } from "../ports/git.js";

export function prepareRunBranch(
  shortName: ShortName,
  planBranch: string,
  repoRoot: string,
  allowDirty?: boolean,
): Effect.Effect<BranchName, UnsafeGitStateError | GitError, Git> {
  return Effect.gen(function* () {
    const git = yield* Git;

    if (!allowDirty) {
      const clean = yield* git.isClean(repoRoot);
      if (!clean) {
        return yield* Effect.fail(
          new UnsafeGitStateError({
            message: "Working tree is not clean. Commit or stash changes, or pass --allow-dirty.",
            repoPath: repoRoot,
          }),
        );
      }
    }

    const branchResult = decodeBranchName(planBranch);
    if (Either.isLeft(branchResult)) {
      return yield* Effect.fail(
        new UnsafeGitStateError({
          message: `Invalid branch name "${planBranch}": must be non-empty`,
          repoPath: repoRoot,
        }),
      );
    }
    const branch = branchResult.right;

    const exists = yield* git.branchExists(branch, repoRoot);
    if (!exists) {
      const currentBranch = yield* git.currentBranch(repoRoot);
      yield* git.createBranch(branch, currentBranch, repoRoot);
    }

    return branch;
  });
}

export function createPhaseWorktree(
  shortName: ShortName,
  phaseId: PhaseId,
  branch: BranchName,
  stateRoot: string,
  repoRoot: string,
): Effect.Effect<WorktreePath, WorktreeCreationError | GitError, Git> {
  return Effect.gen(function* () {
    const git = yield* Git;

    const worktreeDir = join(stateRoot, "worktrees", shortName, phaseId);
    const pathResult = decodeWorktreePath(worktreeDir);
    if (Either.isLeft(pathResult)) {
      return yield* Effect.fail(
        new WorktreeCreationError({
          message: `Invalid worktree path "${worktreeDir}"`,
          branch,
          path: worktreeDir,
        }),
      );
    }
    const worktreePath = pathResult.right;

    // Idempotent: when resuming a rate-limited phase the worktree already
    // exists. Reuse it — `git worktree add` would fail on an occupied path,
    // and the partial work / session state must be preserved.
    if (existsSync(worktreeDir)) {
      return worktreePath;
    }

    yield* git.addWorktree(branch, worktreePath, repoRoot).pipe(
      Effect.mapError(
        (err) =>
          new WorktreeCreationError({
            message: `Failed to create worktree at "${worktreeDir}": ${err.message}`,
            branch,
            path: worktreeDir,
          }),
      ),
    );

    return worktreePath;
  });
}

export function removePhaseWorktree(
  path: WorktreePath,
  force: boolean,
  repoRoot: string,
): Effect.Effect<void, ArchiveBlockedByDirtyWorktreeError | GitError, Git> {
  return Effect.gen(function* () {
    const git = yield* Git;

    if (!force) {
      const clean = yield* git.worktreeIsClean(path);
      if (!clean) {
        return yield* Effect.fail(
          new ArchiveBlockedByDirtyWorktreeError({
            message: `Worktree at "${path}" has uncommitted changes. Commit changes or use --force.`,
            worktreePath: path,
          }),
        );
      }
    }

    yield* git.removeWorktree(path, force, repoRoot);
  });
}
