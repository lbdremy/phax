import { Effect, Either } from "effect";
import { join } from "node:path";
import { Git, type GitError } from "../ports/git.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { BranchName, PhaseId, ShortName, WorktreePath } from "../domain/branded.js";
import { decodeBranchName, decodeWorktreePath } from "../domain/branded.js";
import { UnsafeGitStateError, WorktreeCreationError } from "../domain/errors.js";
import { runKey } from "../domain/runRef.js";

const FULL_COMMIT_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/**
 * A phase branch after `preparePhaseBranch`: phax just created it, and `base`
 * is the full sha of the commit it was created from; or it already existed,
 * and its base is whatever the phase status noted when phax created it.
 */
export type PreparedPhaseBranch =
  | { readonly kind: "created"; readonly branch: BranchName; readonly base: string }
  | { readonly kind: "existing"; readonly branch: BranchName };

/**
 * Ensure a per-phase branch exists, creating it from `fromBranch` if absent.
 *
 * Branch name convention: `${baseBranch}--${phaseId}` (e.g. `ai/my-run--phase-01`).
 * The `--` separator avoids the `refs/heads/<base>/<phase>` dir-vs-file conflict
 * that `/` would cause when `baseBranch` contains a slash.
 *
 * Phase-01 branches off the run branch; phase-N branches off phase-(N-1). The
 * caller maintains `fromBranch` across iterations and passes it in.
 *
 * A branch it creates is resolved right away: its tip is exactly the commit it
 * was created from, the phase's `base`.
 */
export function preparePhaseBranch(
  baseBranch: BranchName,
  phaseId: PhaseId,
  fromBranch: BranchName,
  repoRoot: string,
): Effect.Effect<PreparedPhaseBranch, UnsafeGitStateError | GitError, Git> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const phaseBranchStr = `${baseBranch}--${phaseId}`;
    const branchResult = decodeBranchName(phaseBranchStr);
    if (Either.isLeft(branchResult)) {
      return yield* Effect.fail(
        new UnsafeGitStateError({
          message: `Invalid phase branch name "${phaseBranchStr}": must be non-empty`,
          repoPath: repoRoot,
        }),
      );
    }
    const phaseBranch = branchResult.right;

    const exists = yield* git.branchExists(phaseBranch, repoRoot);
    if (exists) return { kind: "existing", branch: phaseBranch };

    yield* git.createBranch(phaseBranch, fromBranch, repoRoot);
    const base = yield* git.resolveRef(repoRoot, phaseBranch);
    if (base === null || !FULL_COMMIT_SHA.test(base)) {
      return yield* Effect.fail(
        new UnsafeGitStateError({
          message: `Phase branch "${phaseBranch}" was created from "${fromBranch}", but its commit could not be resolved to a full object name (got ${base === null ? "nothing" : `"${base}"`})`,
          repoPath: repoRoot,
        }),
      );
    }
    return { kind: "created", branch: phaseBranch, base };
  });
}

/**
 * Refuse a dirty working tree unless `allowDirty`. Read-only: it only asks
 * `git.isClean`, and makes no git call at all when `allowDirty` is set.
 */
export function checkCleanWorkingTree(
  repoRoot: string,
  allowDirty: boolean,
): Effect.Effect<void, UnsafeGitStateError | GitError, Git> {
  if (allowDirty) return Effect.void;
  return Effect.gen(function* () {
    const git = yield* Git;
    const clean = yield* git.isClean(repoRoot);
    if (!clean) {
      return yield* Effect.fail(
        new UnsafeGitStateError({
          message: "Working tree is not clean. Commit or stash changes, or pass --allow-dirty.",
          repoPath: repoRoot,
        }),
      );
    }
  });
}

export function prepareRunBranch(
  _shortName: ShortName,
  planBranch: string,
  repoRoot: string,
  allowDirty?: boolean,
): Effect.Effect<BranchName, UnsafeGitStateError | GitError, Git> {
  return Effect.gen(function* () {
    const git = yield* Git;

    // Branch creation keeps its own dirty-tree refusal, even after a preflight.
    yield* checkCleanWorkingTree(repoRoot, allowDirty ?? false);

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
  namespace: string,
  shortName: ShortName,
  phaseId: PhaseId,
  branch: BranchName,
  stateRoot: string,
  repoRoot: string,
): Effect.Effect<WorktreePath, WorktreeCreationError | GitError | FsError, Git | FileSystem> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem;

    const worktreeDir = join(stateRoot, "worktrees", runKey(namespace, shortName), phaseId);
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
