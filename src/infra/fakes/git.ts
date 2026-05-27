import { Effect, Layer } from "effect";
import type { BranchName, WorktreePath } from "../../domain/branded.js";
import { Git, type GitOps, GitError } from "../../ports/git.js";

export type GitCall =
  | { method: "isClean"; repo: string }
  | { method: "currentBranch"; repo: string }
  | { method: "createBranch"; branch: string; from: string; repo: string }
  | { method: "branchExists"; branch: string; repo: string }
  | { method: "addWorktree"; branch: string; path: string; repo: string }
  | { method: "removeWorktree"; path: string; force: boolean; repo: string }
  | { method: "commit"; repo: string; subject: string; body: string }
  | { method: "worktreeIsClean"; path: string }
  | { method: "pruneWorktrees"; repo: string };

export class FakeGitImpl implements GitOps {
  readonly calls: GitCall[] = [];
  readonly cleanWorktrees = new Set<string>();
  readonly worktreeIsCleanQueue = new Map<string, boolean[]>();
  isCleanDefault = true;
  activeBranch: BranchName = "main" as BranchName;
  readonly existingBranches = new Set<string>();

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
}

export const makeFakeGit = () => {
  const impl = new FakeGitImpl();
  const layer = Layer.succeed(Git, impl);
  return { impl, layer } as const;
};
