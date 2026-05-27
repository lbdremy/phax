import { Effect, Either } from "effect";
import { join } from "node:path";
import { Git, type GitError } from "../ports/git.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { BranchName, PhaseId, ShortName, WorktreePath } from "../domain/branded.js";
import { decodeBranchName, decodeWorktreePath } from "../domain/branded.js";
import { UnsafeGitStateError, WorktreeCreationError } from "../domain/errors.js";

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

export const PHAX_CONTEXT_DIR = ".phax-context";

/**
 * Ensure `<worktree>/.gitignore` excludes `.phax-context/`. Phax writes phase
 * metadata (handoff, summary) inside that folder; gitignoring it lets the
 * commit step run a plain `git add . && git commit` without dragging phax
 * artifacts into the project history.
 *
 * Idempotent: appends only if the rule is absent. Creates `.gitignore` if it
 * does not already exist.
 */
function ensurePhaxContextIgnored(worktreePath: string): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    // `git worktree add` already creates the worktree dir; this mkdirp is a
    // no-op there but lets fake-git unit tests (which don't materialise the
    // worktree) hit the same path safely.
    yield* fs.mkdirp(worktreePath);

    const gitignorePath = join(worktreePath, ".gitignore");
    const rule = `${PHAX_CONTEXT_DIR}/`;
    const present = yield* fs.exists(gitignorePath);
    const existing = present ? yield* fs.readText(gitignorePath) : "";
    const alreadyPresent = existing
      .split("\n")
      .map((l) => l.trim())
      .some((l) => l === rule);
    if (!alreadyPresent) {
      const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
      yield* fs.writeAtomic(
        gitignorePath,
        `${existing}${needsLeadingNewline ? "\n" : ""}${rule}\n`,
      );
    }

    // The folder is empty until the agent writes into it, and git tracks
    // contents not directories, so this has no effect on the commit.
    yield* fs.mkdirp(join(worktreePath, PHAX_CONTEXT_DIR));
  });
}

export function createPhaseWorktree(
  shortName: ShortName,
  phaseId: PhaseId,
  branch: BranchName,
  stateRoot: string,
  repoRoot: string,
): Effect.Effect<WorktreePath, WorktreeCreationError | GitError | FsError, Git | FileSystem> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem;

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
    const alreadyExists = yield* fs.exists(worktreeDir);
    if (alreadyExists) {
      yield* ensurePhaxContextIgnored(worktreeDir);
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

    yield* ensurePhaxContextIgnored(worktreeDir);

    return worktreePath;
  });
}

