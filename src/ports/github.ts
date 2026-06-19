import { Context, Data, Effect } from "effect";
import type { BranchName } from "../domain/branded.js";

export class GitHubError extends Data.TaggedError("GitHubError")<{
  message: string;
  command: string;
  stderr?: string | undefined;
  exitCode?: number | undefined;
  args?: readonly string[];
}> {}

export interface GitHubOps {
  isAvailable(): Effect.Effect<boolean, GitHubError>;
  isAuthenticated(repo: string): Effect.Effect<boolean, GitHubError>;
  repoRecognized(repo: string): Effect.Effect<boolean, GitHubError>;
  defaultBaseBranch(repo: string): Effect.Effect<string, GitHubError>;
  findPullRequestForBranch(
    branch: BranchName,
    repo: string,
  ): Effect.Effect<string | null, GitHubError>;
  createPullRequest(input: {
    branch: BranchName;
    base: string;
    title: string;
    bodyFile: string;
    repo: string;
  }): Effect.Effect<string, GitHubError>;
  createIssue(input: {
    repo: string;
    title: string;
    bodyFile: string;
  }): Effect.Effect<string, GitHubError>;
  createGist(input: {
    description: string;
    file: string;
    public: boolean;
  }): Effect.Effect<string, GitHubError>;
}

export class GitHub extends Context.Tag("phax/GitHub")<GitHub, GitHubOps>() {}
