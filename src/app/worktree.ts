import { Effect, Result } from "effect";
import { join } from "node:path";
import { Git, type GitError } from "../ports/git.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { BranchName, PhaseId, ShortName, WorktreePath } from "../domain/branded.js";
import { decodeBranchName, decodeWorktreePath } from "../domain/branded.js";
import {
  type PhaxContextRefusedError,
  UnsafeGitStateError,
  WorktreeCreationError,
} from "../domain/errors.js";
import { runKey } from "../domain/runRef.js";
import { ensurePhaxContextDir, PHAX_CONTEXT_DIR, writePhaxContextFile } from "./phaxContext.js";

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
    if (Result.isFailure(branchResult)) {
      return yield* Effect.fail(
        new UnsafeGitStateError({
          message: `Invalid phase branch name "${phaseBranchStr}": must be non-empty`,
          repoPath: repoRoot,
        }),
      );
    }
    const phaseBranch = branchResult.success;

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
    return undefined;
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
    if (Result.isFailure(branchResult)) {
      return yield* Effect.fail(
        new UnsafeGitStateError({
          message: `Invalid branch name "${planBranch}": must be non-empty`,
          repoPath: repoRoot,
        }),
      );
    }
    const branch = branchResult.success;

    const exists = yield* git.branchExists(branch, repoRoot);
    if (!exists) {
      const currentBranch = yield* git.currentBranch(repoRoot);
      yield* git.createBranch(branch, currentBranch, repoRoot);
    }

    return branch;
  });
}

/** The full plan inside a phase worktree, which the phase prompt names. */
export const PHASE_PLAN_FILE = join(PHAX_CONTEXT_DIR, "plan.md");

/** Write the run's plan.md, byte for byte, to `<worktree>/.phax-context/plan.md`. */
export function writePhasePlanFile(
  worktreePath: string,
  planMd: string,
): Effect.Effect<void, PhaxContextRefusedError | FsError, FileSystem> {
  return writePhaxContextFile(worktreePath, PHASE_PLAN_FILE, planMd);
}

/** The repository's info/exclude line that keeps every worktree's `.phax-context` out of git. */
const PHAX_CONTEXT_EXCLUDE = `/${PHAX_CONTEXT_DIR}`;

/**
 * Keep `.phax-context` out of git and make sure it is a real directory. The
 * ignore rule is one `/.phax-context` line in the repository's info/exclude,
 * shared by every worktree, so no tracked file changes: the commit step runs a
 * plain `git add -A` without phax metadata, or phax's own ignore line, entering
 * the history. Unlike `.phax-context/`, the rule also matches a symbolic link
 * of that name. `.phax-context` is then created, or used when it is already a
 * real directory, and refused otherwise.
 */
function preparePhaxContext(
  worktreePath: string,
  repoRoot: string,
): Effect.Effect<void, PhaxContextRefusedError | GitError | FsError, Git | FileSystem> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem;
    yield* git.ensureInfoExclude(repoRoot, PHAX_CONTEXT_EXCLUDE);
    // `git worktree add` already creates the worktree dir; this mkdirp is a
    // no-op there but lets fake-git unit tests (which don't materialise the
    // worktree) hit the same path safely.
    yield* fs.mkdirp(worktreePath);
    yield* ensurePhaxContextDir(worktreePath);
  });
}

export function createPhaseWorktree(
  namespace: string,
  shortName: ShortName,
  phaseId: PhaseId,
  branch: BranchName,
  stateRoot: string,
  repoRoot: string,
): Effect.Effect<
  WorktreePath,
  WorktreeCreationError | PhaxContextRefusedError | GitError | FsError,
  Git | FileSystem
> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem;

    const worktreeDir = join(stateRoot, "worktrees", runKey(namespace, shortName), phaseId);
    const pathResult = decodeWorktreePath(worktreeDir);
    if (Result.isFailure(pathResult)) {
      return yield* Effect.fail(
        new WorktreeCreationError({
          message: `Invalid worktree path "${worktreeDir}"`,
          branch,
          path: worktreeDir,
        }),
      );
    }
    const worktreePath = pathResult.success;

    // Idempotent: when resuming a rate-limited phase the worktree already
    // exists. Reuse it — `git worktree add` would fail on an occupied path,
    // and the partial work / session state must be preserved.
    const alreadyExists = yield* fs.exists(worktreeDir);
    if (alreadyExists) {
      yield* preparePhaxContext(worktreeDir, repoRoot);
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

    yield* preparePhaxContext(worktreeDir, repoRoot);

    return worktreePath;
  });
}
