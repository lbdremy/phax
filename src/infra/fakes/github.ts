import { Effect, Layer } from "effect";
import type { BranchName } from "../../domain/branded.js";
import { GitHub, type GitHubOps, GitHubError } from "../../ports/github.js";

export type GitHubCall =
  | { method: "isAvailable" }
  | { method: "isAuthenticated"; repo: string }
  | { method: "repoRecognized"; repo: string }
  | { method: "defaultBaseBranch"; repo: string }
  | { method: "findPullRequestForBranch"; branch: string; repo: string }
  | {
      method: "createPullRequest";
      branch: string;
      base: string;
      title: string;
      bodyFile: string;
      repo: string;
    };

export class FakeGitHubImpl implements GitHubOps {
  readonly calls: GitHubCall[] = [];

  available = true;
  authenticated = true;
  recognized = true;
  configuredDefaultBranch = "main";
  readonly existingPrs = new Map<string, string>();
  createdPrUrl = "https://github.com/owner/repo/pull/1";
  private nextCreatePrError: string | undefined;

  setAvailable(value: boolean): void {
    this.available = value;
  }

  setAuthenticated(value: boolean): void {
    this.authenticated = value;
  }

  setRepoRecognized(value: boolean): void {
    this.recognized = value;
  }

  setDefaultBranch(branch: string): void {
    this.configuredDefaultBranch = branch;
  }

  seedExistingPr(branch: string, url: string): void {
    this.existingPrs.set(branch, url);
  }

  setCreatedPrUrl(url: string): void {
    this.createdPrUrl = url;
  }

  failNextCreatePr(stderr: string): void {
    this.nextCreatePrError = stderr;
  }

  isAvailable(): Effect.Effect<boolean, GitHubError> {
    this.calls.push({ method: "isAvailable" });
    return Effect.succeed(this.available);
  }

  isAuthenticated(repo: string): Effect.Effect<boolean, GitHubError> {
    this.calls.push({ method: "isAuthenticated", repo });
    return Effect.succeed(this.authenticated);
  }

  repoRecognized(repo: string): Effect.Effect<boolean, GitHubError> {
    this.calls.push({ method: "repoRecognized", repo });
    return Effect.succeed(this.recognized);
  }

  defaultBaseBranch(repo: string): Effect.Effect<string, GitHubError> {
    this.calls.push({ method: "defaultBaseBranch", repo });
    return Effect.succeed(this.configuredDefaultBranch);
  }

  findPullRequestForBranch(
    branch: BranchName,
    repo: string,
  ): Effect.Effect<string | null, GitHubError> {
    this.calls.push({ method: "findPullRequestForBranch", branch, repo });
    return Effect.succeed(this.existingPrs.get(branch as string) ?? null);
  }

  createPullRequest(input: {
    branch: BranchName;
    base: string;
    title: string;
    bodyFile: string;
    repo: string;
  }): Effect.Effect<string, GitHubError> {
    this.calls.push({
      method: "createPullRequest",
      branch: input.branch as string,
      base: input.base,
      title: input.title,
      bodyFile: input.bodyFile,
      repo: input.repo,
    });
    if (this.nextCreatePrError !== undefined) {
      const stderr = this.nextCreatePrError;
      this.nextCreatePrError = undefined;
      return Effect.fail(
        new GitHubError({
          message: `gh pr create failed: ${stderr}`,
          command: "gh pr create",
          stderr,
          exitCode: 1,
        }),
      );
    }
    return Effect.succeed(this.createdPrUrl);
  }
}

export const makeFakeGitHub = () => {
  const impl = new FakeGitHubImpl();
  const layer = Layer.succeed(GitHub, impl);
  return { impl, layer } as const;
};
