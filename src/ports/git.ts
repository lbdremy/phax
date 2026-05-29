import { Context, Data, Effect } from "effect";
import type { BranchName, WorktreePath } from "../domain/branded.js";

export class GitError extends Data.TaggedError("GitError")<{
  message: string;
  command: string;
  stderr?: string | undefined;
  exitCode?: number | undefined;
  args?: readonly string[];
  stderrExcerpt?: string;
  expected?: string;
}> {}

export interface GitOps {
  isClean(repo: string): Effect.Effect<boolean, GitError>;
  currentBranch(repo: string): Effect.Effect<BranchName, GitError>;
  createBranch(branch: BranchName, from: BranchName, repo: string): Effect.Effect<void, GitError>;
  branchExists(branch: BranchName, repo: string): Effect.Effect<boolean, GitError>;
  addWorktree(branch: BranchName, path: WorktreePath, repo: string): Effect.Effect<void, GitError>;
  removeWorktree(path: WorktreePath, force: boolean, repo: string): Effect.Effect<void, GitError>;
  commit(repo: string, subject: string, body: string): Effect.Effect<void, GitError>;
  worktreeIsClean(path: WorktreePath): Effect.Effect<boolean, GitError>;
}

export class Git extends Context.Tag("phax/Git")<Git, GitOps>() {}
