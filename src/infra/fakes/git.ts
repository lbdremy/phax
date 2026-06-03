import { Effect, Layer } from "effect";
import type { BranchName, WorktreePath } from "../../domain/branded.js";
import { Git, type GitOps, GitError } from "../../ports/git.js";
import type { NameStatusEntry } from "../../domain/reconciliation/types.js";

export type GitCall =
  | { method: "isClean"; repo: string }
  | { method: "currentBranch"; repo: string }
  | { method: "createBranch"; branch: string; from: string; repo: string }
  | { method: "branchExists"; branch: string; repo: string }
  | { method: "addWorktree"; branch: string; path: string; repo: string }
  | { method: "removeWorktree"; path: string; force: boolean; repo: string }
  | { method: "commit"; repo: string; subject: string; body: string }
  | { method: "worktreeIsClean"; path: string }
  | { method: "pruneWorktrees"; repo: string }
  | { method: "diffNameStatus"; path: string };

export class FakeGitImpl implements GitOps {
  readonly calls: GitCall[] = [];
  readonly cleanWorktrees = new Set<string>();
  readonly worktreeIsCleanQueue = new Map<string, boolean[]>();
  readonly diffNameStatusQueue = new Map<string, NameStatusEntry[]>();
  isCleanDefault = true;
  activeBranch: BranchName = "main" as BranchName;
  readonly existingBranches = new Set<string>();
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

  private nextAddWorktreeError: string | undefined;

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
}

export const makeFakeGit = () => {
  const impl = new FakeGitImpl();
  const layer = Layer.succeed(Git, impl);
  return { impl, layer } as const;
};
