import { Context, Data, Effect } from "effect";
import type { BranchName, WorktreePath } from "../domain/branded.js";
import type { ChangedPath } from "../domain/interactive/worktreeChange.js";
import type { NameStatusEntry } from "../domain/reconciliation/types.js";
import type { ProtectedObservation } from "../domain/security/protectedPaths.js";

export class GitError extends Data.TaggedError("GitError")<{
  message: string;
  command: string;
  stderr?: string | undefined;
  exitCode?: number | undefined;
  args?: readonly string[];
  stderrExcerpt?: string;
  expected?: string;
}> {}

/** A file to write into a records tree: a repo-relative path and its raw bytes. */
export interface GitFileEntry {
  readonly path: string;
  readonly content: Uint8Array;
}

/** One blob entry of a git tree, as produced by `git ls-tree -r`. */
export interface GitTreeEntry {
  readonly mode: string;
  readonly type: "blob" | "tree";
  readonly oid: string;
  readonly path: string;
}

/** One entry of `git worktree list --porcelain`. */
export interface GitWorktreeEntry {
  readonly path: string;
  /** Short branch name (no `refs/heads/`), or null for a detached or bare entry. */
  readonly branch: string | null;
  readonly prunable: boolean;
}

/** Inputs for writing a tree-only commit onto a branch. */
export interface WriteTreeCommitInput {
  readonly repo: string;
  readonly branch: BranchName;
  /** The full commit message (subject and body already joined). */
  readonly message: string;
  readonly files: readonly GitFileEntry[];
}

export interface GitOps {
  isClean(repo: string): Effect.Effect<boolean, GitError>;
  currentBranch(repo: string): Effect.Effect<BranchName, GitError>;
  createBranch(branch: BranchName, from: BranchName, repo: string): Effect.Effect<void, GitError>;
  branchExists(branch: BranchName, repo: string): Effect.Effect<boolean, GitError>;
  deleteBranch(name: BranchName, force: boolean, repo: string): Effect.Effect<void, GitError>;
  addWorktree(branch: BranchName, path: WorktreePath, repo: string): Effect.Effect<void, GitError>;
  removeWorktree(path: WorktreePath, force: boolean, repo: string): Effect.Effect<void, GitError>;
  commit(repo: string, subject: string, body: string): Effect.Effect<void, GitError>;
  dirtyPaths(repo: string, paths: readonly string[]): Effect.Effect<readonly string[], GitError>;
  commitPaths(
    repo: string,
    paths: readonly string[],
    subject: string,
    body: string,
  ): Effect.Effect<void, GitError>;
  /**
   * The unified diff of two files outside any index (`git diff --no-index`),
   * run from `repo`: empty when they are identical. Differences are not an
   * error. The header names `label` (a repo-relative path) on both sides, not
   * the two files compared.
   */
  diffNoIndex(
    repo: string,
    beforePath: string,
    afterPath: string,
    label: string,
  ): Effect.Effect<string, GitError>;
  worktreeIsClean(path: WorktreePath): Effect.Effect<boolean, GitError>;
  pruneWorktrees(repo: string): Effect.Effect<void, GitError>;
  diffNameStatus(path: WorktreePath): Effect.Effect<readonly NameStatusEntry[], GitError>;
  remoteExists(remote: string, repo: string): Effect.Effect<boolean, GitError>;
  pushBranch(branch: BranchName, remote: string, repo: string): Effect.Effect<void, GitError>;
  headCommit(repo: string): Effect.Effect<string, GitError>;
  commitExists(commit: string, repo: string): Effect.Effect<boolean, GitError>;
  changedFilesSince(baseline: string, repo: string): Effect.Effect<readonly string[], GitError>;

  /**
   * Write `files` as a single commit on `branch` without touching the working
   * tree or the index. The branch is created as an orphan (no parent) on its
   * first write and parents onto its current tip on every write thereafter.
   * Returns the new commit sha.
   */
  writeTreeCommit(input: WriteTreeCommitInput): Effect.Effect<string, GitError>;
  /**
   * Resolve a ref (branch, remote-tracking ref, or object id) to a commit sha,
   * or `null` when it does not exist.
   */
  resolveRef(repo: string, ref: string): Effect.Effect<string | null, GitError>;
  /** Recursively list the blob entries of a commit-or-tree. */
  readTree(repo: string, treeish: string): Effect.Effect<readonly GitTreeEntry[], GitError>;
  /** Read a blob's raw bytes by object id. */
  readBlob(repo: string, oid: string): Effect.Effect<Uint8Array, GitError>;

  /**
   * Fully clone `remote` into `path`, which must not yet exist (its parent
   * must). No `--filter`: a blobless partial clone would defeat the offline
   * read the records design exists to guarantee.
   */
  cloneRepo(remote: string, path: string): Effect.Effect<void, GitError>;
  /** Fetch `remote`'s refs into `repo`'s remote-tracking refs. */
  fetchRemote(remote: string, repo: string): Effect.Effect<void, GitError>;
  /** The URL configured for `remote` in `repo`, or `null` when no such remote exists. */
  remoteUrl(remote: string, repo: string): Effect.Effect<string | null, GitError>;
  /**
   * The name git commits under in `repo` (`GIT_COMMITTER_NAME`, else
   * `user.name`), or `null` when neither is set — never a guessed name.
   */
  committerName(repo: string): Effect.Effect<string | null, GitError>;
  /**
   * The identity git authors a commit under in `repo`: the name is
   * `GIT_AUTHOR_NAME`, else `author.name`, else `user.name`; the email is
   * `GIT_AUTHOR_EMAIL`, else `author.email`, else `user.email`. `null` when
   * either is unset or empty — never a guessed identity (no host-name
   * fallback).
   */
  authorIdentity(
    repo: string,
  ): Effect.Effect<{ readonly name: string; readonly email: string } | null, GitError>;

  /** The full ref names under `prefix` (e.g. `refs/heads/`, `refs/remotes/`), sorted. */
  listRefs(repo: string, prefix: string): Effect.Effect<readonly string[], GitError>;
  /**
   * The number of commits reachable from `refs/heads/<branch>` that no local
   * branch outside `deleting`, no tag and no remote-tracking ref reaches.
   */
  countUnpreservedCommits(
    repo: string,
    branch: BranchName,
    deleting: readonly BranchName[],
  ): Effect.Effect<number, GitError>;
  /** The worktrees `repo` knows about, main worktree included. */
  listWorktrees(repo: string): Effect.Effect<readonly GitWorktreeEntry[], GitError>;

  /**
   * The last commit reachable from HEAD whose committer date is before
   * `instant` (ISO-8601), or `null` when there is none.
   */
  commitBefore(repo: string, instant: string): Effect.Effect<string | null, GitError>;
  /**
   * The byte size of each path's blob at `commit`, keyed by the path as given.
   * A path absent at that commit, or naming a tree or a submodule, counts 0.
   */
  blobSizes(
    repo: string,
    commit: string,
    paths: readonly string[],
  ): Effect.Effect<Readonly<Record<string, number>>, GitError>;

  /** The tree id of HEAD in the worktree at `path` (`git rev-parse HEAD^{tree}`). */
  headTree(path: string): Effect.Effect<string, GitError>;
  /**
   * The tree id of the worktree at `path` as it stands, `.phax-context/` left
   * out. Built in a temporary index seeded from HEAD, so a tracked file that
   * matches an ignore pattern keeps its HEAD entry; the real index is never
   * touched. An untracked ignored file is never seen.
   */
  snapshotWorktree(path: string): Effect.Effect<string, GitError>;
  /** The paths that differ between two trees, with no rename detection. */
  changedPathsBetween(
    path: string,
    fromTree: string,
    toTree: string,
  ): Effect.Effect<readonly ChangedPath[], GitError>;
  /**
   * The worktree at `path`, as it stands on disk, against commit `base`.
   * `entries` is the name-status, with renames, of `base` against a tree of
   * the worktree built in a temporary index seeded from HEAD, `.phax-context/`
   * left out. `tracked` holds, for each file of `base`'s tree whose path
   * `isProtected` accepts, in tree order, how the file on disk compares with
   * its blob there; a submodule is left out. `base`'s tree is read once, in
   * full, and the files are hashed by one process, so no argument list grows
   * with their number. `untracked` holds the untracked files git ignores,
   * outside `.phax-context/`. The real index is never read for a verdict, so
   * skip-worktree and assume-unchanged bits cannot hide an edit, and it is
   * never touched.
   */
  observeWorktree(
    path: string,
    base: string,
    isProtected: (path: string) => boolean,
  ): Effect.Effect<ProtectedObservation, GitError>;
  /**
   * Bring `paths` in the worktree at `path` back to their content in `tree`:
   * a path present in `tree` is checked out of it, a path absent from it is
   * deleted. Done through a temporary index; the real index, ignored files
   * and `.phax-context/` are never touched.
   */
  restorePaths(path: string, tree: string, paths: readonly string[]): Effect.Effect<void, GitError>;
  /**
   * The content diff between two trees (`git diff-tree -p -r --no-color
   * --no-ext-diff --no-textconv --no-renames`): empty when they are equal.
   */
  diffTrees(repo: string, fromTree: string, toTree: string): Effect.Effect<string, GitError>;
  /**
   * Commit exactly `tree` onto HEAD of the worktree at `worktree`, through
   * `git commit --allow-empty` from a temporary index holding `tree`, so the
   * repository's hooks and signing config run as for any commit. A hook that
   * changes the committed tree fails it, with the branch moved back to the old
   * HEAD and the changed paths named. On success the real index is reset to
   * the new HEAD. Returns the new commit sha.
   */
  commitTree(
    worktree: string,
    tree: string,
    subject: string,
    body: string,
  ): Effect.Effect<string, GitError>;
}

export class Git extends Context.Tag("phax/Git")<Git, GitOps>() {}
