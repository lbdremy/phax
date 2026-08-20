import { Context, Data, Effect } from "effect";
import type { BranchName, WorktreePath } from "../domain/branded.js";
import type { NameStatusEntry } from "../domain/reconciliation/types.js";

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
}

export class Git extends Context.Tag("phax/Git")<Git, GitOps>() {}
