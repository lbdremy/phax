import { Effect, Layer } from "effect";
import type { BranchName, WorktreePath } from "../../domain/branded.js";
import {
  Git,
  type GitOps,
  GitError,
  type GitTreeEntry,
  type WriteTreeCommitInput,
} from "../../ports/git.js";
import type { NameStatusEntry } from "../../domain/reconciliation/types.js";

// Deterministic 40-hex object id derived from bytes, so the fake round-trips
// blobs and trees without a real hash. Not git-compatible; collision-free enough
// for tests.
function fakeOidFromBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const byte of bytes) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").repeat(5).slice(0, 40);
}

function fakeOidFromString(input: string): string {
  return fakeOidFromBytes(new TextEncoder().encode(input));
}

export type GitCall =
  | { method: "isClean"; repo: string }
  | { method: "currentBranch"; repo: string }
  | { method: "createBranch"; branch: string; from: string; repo: string }
  | { method: "branchExists"; branch: string; repo: string }
  | { method: "deleteBranch"; name: string; force: boolean; repo: string }
  | { method: "addWorktree"; branch: string; path: string; repo: string }
  | { method: "removeWorktree"; path: string; force: boolean; repo: string }
  | { method: "commit"; repo: string; subject: string; body: string }
  | { method: "dirtyPaths"; repo: string; paths: readonly string[] }
  | {
      method: "commitPaths";
      repo: string;
      paths: readonly string[];
      subject: string;
      body: string;
    }
  | { method: "worktreeIsClean"; path: string }
  | { method: "pruneWorktrees"; repo: string }
  | { method: "diffNameStatus"; path: string }
  | { method: "remoteExists"; remote: string; repo: string }
  | { method: "pushBranch"; branch: string; remote: string; repo: string }
  | { method: "headCommit"; repo: string }
  | { method: "commitExists"; commit: string; repo: string }
  | { method: "changedFilesSince"; baseline: string; repo: string }
  | {
      method: "writeTreeCommit";
      repo: string;
      branch: string;
      message: string;
      paths: readonly string[];
    }
  | { method: "resolveRef"; repo: string; ref: string }
  | { method: "readTree"; repo: string; treeish: string }
  | { method: "readBlob"; repo: string; oid: string };

export class FakeGitImpl implements GitOps {
  readonly calls: GitCall[] = [];
  readonly cleanWorktrees = new Set<string>();
  readonly worktreeIsCleanQueue = new Map<string, boolean[]>();
  readonly diffNameStatusQueue = new Map<string, NameStatusEntry[]>();
  isCleanDefault = true;
  activeBranch: BranchName = "main" as BranchName;
  readonly existingBranches = new Set<string>();
  readonly deletedBranches: { name: string; force: boolean; repo: string }[] = [];
  /** Tracks which branches are currently checked out in a worktree.
   * Maps branch → worktree path; used to simulate git's "already checked out" error. */
  readonly checkedOutBranches = new Map<string, string>();

  setCleanWorktree(path: string, clean: boolean): void {
    if (clean) {
      this.cleanWorktrees.add(path);
    } else {
      this.cleanWorktrees.delete(path);
    }
  }

  setRepoIsClean(clean: boolean): void {
    this.isCleanDefault = clean;
  }

  setActiveBranch(branch: BranchName): void {
    this.activeBranch = branch;
  }

  addExistingBranch(branch: string): void {
    this.existingBranches.add(branch);
  }

  enqueueWorktreeIsClean(path: string, ...values: boolean[]): void {
    const queue = this.worktreeIsCleanQueue.get(path) ?? [];
    queue.push(...values);
    this.worktreeIsCleanQueue.set(path, queue);
  }

  enqueueDiffNameStatus(path: string, entries: NameStatusEntry[]): void {
    this.diffNameStatusQueue.set(path, entries);
  }

  readonly existingRemotes = new Set<string>();
  readonly pushedBranches = new Set<string>();
  private nextAddWorktreeError: string | undefined;
  private nextPushBranchError: string | undefined;

  headCommitValue = "0".repeat(40);
  readonly existingCommits = new Set<string>([this.headCommitValue]);
  readonly changedFilesSinceResults = new Map<string, string[]>();

  setHeadCommit(sha: string): void {
    this.headCommitValue = sha;
    this.existingCommits.add(sha);
  }

  setChangedFilesSince(baseline: string, files: string[]): void {
    this.changedFilesSinceResults.set(baseline, files);
  }

  addExistingRemote(remote: string): void {
    this.existingRemotes.add(remote);
  }

  failNextPushBranch(stderr: string): void {
    this.nextPushBranchError = stderr;
  }

  failNextWorktreeAdd(stderr: string): void {
    this.nextAddWorktreeError = stderr;
  }

  isClean(repo: string): Effect.Effect<boolean, GitError> {
    this.calls.push({ method: "isClean", repo });
    return Effect.succeed(this.isCleanDefault);
  }

  currentBranch(repo: string): Effect.Effect<BranchName, GitError> {
    this.calls.push({ method: "currentBranch", repo });
    return Effect.succeed(this.activeBranch);
  }

  createBranch(branch: BranchName, from: BranchName, repo: string): Effect.Effect<void, GitError> {
    this.calls.push({ method: "createBranch", branch, from, repo });
    this.existingBranches.add(branch);
    return Effect.void;
  }

  branchExists(branch: BranchName, repo: string): Effect.Effect<boolean, GitError> {
    this.calls.push({ method: "branchExists", branch, repo });
    return Effect.succeed(this.existingBranches.has(branch));
  }

  deleteBranch(name: BranchName, force: boolean, repo: string): Effect.Effect<void, GitError> {
    this.calls.push({ method: "deleteBranch", name, force, repo });
    this.deletedBranches.push({ name, force, repo });
    this.existingBranches.delete(name);
    this.checkedOutBranches.delete(name);
    return Effect.void;
  }

  addWorktree(branch: BranchName, path: WorktreePath, repo: string): Effect.Effect<void, GitError> {
    this.calls.push({ method: "addWorktree", branch, path, repo });
    if (this.nextAddWorktreeError !== undefined) {
      const stderr = this.nextAddWorktreeError;
      this.nextAddWorktreeError = undefined;
      return Effect.fail(
        new GitError({
          message: `git worktree add failed: ${stderr}`,
          command: `git worktree add ${path} ${branch}`,
          args: ["worktree", "add", path, branch],
          stderr,
          stderrExcerpt: stderr,
          exitCode: 128,
        }),
      );
    }
    const existingPath = this.checkedOutBranches.get(branch as string);
    if (existingPath !== undefined) {
      return Effect.fail(
        new GitError({
          message: `'${branch}' is already checked out at '${existingPath}'`,
          command: `git worktree add ${path} ${branch}`,
        }),
      );
    }
    this.checkedOutBranches.set(branch as string, path as string);
    return Effect.void;
  }

  removeWorktree(path: WorktreePath, force: boolean, repo: string): Effect.Effect<void, GitError> {
    this.calls.push({ method: "removeWorktree", path, force, repo });
    return Effect.void;
  }

  commit(repo: string, subject: string, body: string): Effect.Effect<void, GitError> {
    this.calls.push({ method: "commit", repo, subject, body });
    return Effect.void;
  }

  readonly dirtyPathsSet = new Set<string>();

  /** Marks exactly these paths as dirty; `dirtyPaths(repo, paths)` returns
   * the intersection of its `paths` argument with this set. */
  setDirtyPaths(paths: readonly string[]): void {
    this.dirtyPathsSet.clear();
    for (const path of paths) this.dirtyPathsSet.add(path);
  }

  private readonly dirtyPathsQueue: (readonly string[])[] = [];

  /** Queues the exact result of the next `dirtyPaths` call (FIFO), bypassing the
   * `dirtyPathsSet` intersection. Use this to distinguish a caller's pre-write and
   * post-write `dirtyPaths` calls within one use case invocation — `setDirtyPaths`
   * alone can't, since it answers every call identically. */
  enqueueDirtyPaths(paths: readonly string[]): void {
    this.dirtyPathsQueue.push(paths);
  }

  dirtyPaths(repo: string, paths: readonly string[]): Effect.Effect<readonly string[], GitError> {
    this.calls.push({ method: "dirtyPaths", repo, paths });
    const queued = this.dirtyPathsQueue.shift();
    if (queued !== undefined) return Effect.succeed(queued);
    return Effect.succeed(paths.filter((path) => this.dirtyPathsSet.has(path)));
  }

  private nextCommitPathsError: string | undefined;

  failNextCommitPaths(stderr: string): void {
    this.nextCommitPathsError = stderr;
  }

  commitPaths(
    repo: string,
    paths: readonly string[],
    subject: string,
    body: string,
  ): Effect.Effect<void, GitError> {
    this.calls.push({ method: "commitPaths", repo, paths, subject, body });
    if (this.nextCommitPathsError !== undefined) {
      const stderr = this.nextCommitPathsError;
      this.nextCommitPathsError = undefined;
      return Effect.fail(
        new GitError({
          message: `git commit failed: ${stderr}`,
          command: `git commit -m ${subject}`,
          stderr,
          stderrExcerpt: stderr,
          exitCode: 1,
        }),
      );
    }
    return Effect.void;
  }

  worktreeIsClean(path: WorktreePath): Effect.Effect<boolean, GitError> {
    this.calls.push({ method: "worktreeIsClean", path });
    const queue = this.worktreeIsCleanQueue.get(path as string);
    if (queue !== undefined && queue.length > 0) {
      return Effect.succeed(queue.shift()!);
    }
    return Effect.succeed(this.cleanWorktrees.has(path as string));
  }

  pruneWorktrees(repo: string): Effect.Effect<void, GitError> {
    this.calls.push({ method: "pruneWorktrees", repo });
    return Effect.void;
  }

  diffNameStatus(path: WorktreePath): Effect.Effect<readonly NameStatusEntry[], GitError> {
    this.calls.push({ method: "diffNameStatus", path: path as string });
    return Effect.succeed(this.diffNameStatusQueue.get(path as string) ?? []);
  }

  remoteExists(remote: string, repo: string): Effect.Effect<boolean, GitError> {
    this.calls.push({ method: "remoteExists", remote, repo });
    return Effect.succeed(this.existingRemotes.has(remote));
  }

  pushBranch(branch: BranchName, remote: string, repo: string): Effect.Effect<void, GitError> {
    this.calls.push({ method: "pushBranch", branch, remote, repo });
    if (this.nextPushBranchError !== undefined) {
      const stderr = this.nextPushBranchError;
      this.nextPushBranchError = undefined;
      return Effect.fail(
        new GitError({
          message: `git push failed: ${stderr}`,
          command: `git push --set-upstream ${remote} ${branch}`,
          args: ["push", "--set-upstream", remote, branch],
          stderr,
          stderrExcerpt: stderr,
          exitCode: 1,
        }),
      );
    }
    this.pushedBranches.add(branch as string);
    return Effect.void;
  }

  headCommit(repo: string): Effect.Effect<string, GitError> {
    this.calls.push({ method: "headCommit", repo });
    return Effect.succeed(this.headCommitValue);
  }

  commitExists(commit: string, repo: string): Effect.Effect<boolean, GitError> {
    this.calls.push({ method: "commitExists", commit, repo });
    return Effect.succeed(this.existingCommits.has(commit));
  }

  changedFilesSince(baseline: string, repo: string): Effect.Effect<readonly string[], GitError> {
    this.calls.push({ method: "changedFilesSince", baseline, repo });
    return Effect.succeed(this.changedFilesSinceResults.get(baseline) ?? []);
  }

  // In-memory git object store backing the records plumbing. Refs map to commit
  // shas; commits carry their tree and parent; trees list blob entries; blobs
  // hold raw bytes.
  readonly fakeBlobs = new Map<string, Uint8Array>();
  readonly fakeTrees = new Map<string, GitTreeEntry[]>();
  readonly fakeCommits = new Map<
    string,
    { tree: string; parent: string | null; message: string }
  >();
  readonly fakeRefs = new Map<string, string>();
  private fakeWriteCounter = 0;

  writeTreeCommit(input: WriteTreeCommitInput): Effect.Effect<string, GitError> {
    this.calls.push({
      method: "writeTreeCommit",
      repo: input.repo,
      branch: input.branch,
      message: input.message,
      paths: input.files.map((f) => f.path),
    });
    const ref = `refs/heads/${input.branch}`;
    const entries: GitTreeEntry[] = input.files
      .map((file) => {
        const oid = fakeOidFromBytes(file.content);
        this.fakeBlobs.set(oid, file.content);
        return { mode: "100644", type: "blob" as const, oid, path: file.path };
      })
      .toSorted((a, b) => a.path.localeCompare(b.path));
    const treeOid = fakeOidFromString(
      `tree:${entries.map((e) => `${e.oid} ${e.path}`).join("\n")}`,
    );
    this.fakeTrees.set(treeOid, entries);
    const parent = this.fakeRefs.get(ref) ?? null;
    const commitOid = fakeOidFromString(
      `commit:${this.fakeWriteCounter++}:${treeOid}:${parent ?? ""}:${input.message}`,
    );
    this.fakeCommits.set(commitOid, { tree: treeOid, parent, message: input.message });
    this.fakeRefs.set(ref, commitOid);
    return Effect.succeed(commitOid);
  }

  resolveRef(repo: string, ref: string): Effect.Effect<string | null, GitError> {
    this.calls.push({ method: "resolveRef", repo, ref });
    const direct = this.fakeRefs.get(ref) ?? this.fakeRefs.get(`refs/heads/${ref}`);
    if (direct !== undefined) return Effect.succeed(direct);
    if (this.fakeCommits.has(ref)) return Effect.succeed(ref);
    return Effect.succeed(null);
  }

  readTree(repo: string, treeish: string): Effect.Effect<readonly GitTreeEntry[], GitError> {
    this.calls.push({ method: "readTree", repo, treeish });
    let treeOid: string | undefined;
    const commit = this.fakeCommits.get(treeish);
    if (commit !== undefined) {
      treeOid = commit.tree;
    } else if (this.fakeTrees.has(treeish)) {
      treeOid = treeish;
    } else {
      const resolved = this.fakeRefs.get(treeish) ?? this.fakeRefs.get(`refs/heads/${treeish}`);
      if (resolved !== undefined) treeOid = this.fakeCommits.get(resolved)?.tree;
    }
    if (treeOid === undefined) {
      return Effect.fail(
        new GitError({
          message: `unknown tree-ish: ${treeish}`,
          command: `git ls-tree -r ${treeish}`,
        }),
      );
    }
    return Effect.succeed(this.fakeTrees.get(treeOid) ?? []);
  }

  readBlob(repo: string, oid: string): Effect.Effect<Uint8Array, GitError> {
    this.calls.push({ method: "readBlob", repo, oid });
    const content = this.fakeBlobs.get(oid);
    if (content === undefined) {
      return Effect.fail(
        new GitError({ message: `unknown blob: ${oid}`, command: `git cat-file blob ${oid}` }),
      );
    }
    return Effect.succeed(content);
  }
}

export const makeFakeGit = () => {
  const impl = new FakeGitImpl();
  const layer = Layer.succeed(Git, impl);
  return { impl, layer } as const;
};
