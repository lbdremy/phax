import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeFakeGitHub } from "../../../src/infra/fakes/github.js";

describe("FakeGitHubImpl contract", () => {
  it("isAvailable returns true by default and records the call", async () => {
    const { impl, layer } = makeFakeGitHub();
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          return yield* impl.isAvailable();
        }),
        layer,
      ),
    );
    expect(result).toBe(true);
    expect(impl.calls).toEqual([{ method: "isAvailable" }]);
  });

  it("isAvailable returns false when setAvailable(false)", async () => {
    const { impl } = makeFakeGitHub();
    impl.setAvailable(false);
    const result = await Effect.runPromise(impl.isAvailable());
    expect(result).toBe(false);
  });

  it("isAuthenticated returns true by default", async () => {
    const { impl } = makeFakeGitHub();
    const result = await Effect.runPromise(impl.isAuthenticated("/repo"));
    expect(result).toBe(true);
    expect(impl.calls).toEqual([{ method: "isAuthenticated", repo: "/repo" }]);
  });

  it("isAuthenticated returns false when setAuthenticated(false)", async () => {
    const { impl } = makeFakeGitHub();
    impl.setAuthenticated(false);
    const result = await Effect.runPromise(impl.isAuthenticated("/repo"));
    expect(result).toBe(false);
  });

  it("repoRecognized returns true by default", async () => {
    const { impl } = makeFakeGitHub();
    const result = await Effect.runPromise(impl.repoRecognized("/repo"));
    expect(result).toBe(true);
  });

  it("repoRecognized returns false when setRepoRecognized(false)", async () => {
    const { impl } = makeFakeGitHub();
    impl.setRepoRecognized(false);
    const result = await Effect.runPromise(impl.repoRecognized("/repo"));
    expect(result).toBe(false);
  });

  it("defaultBaseBranch returns 'main' by default", async () => {
    const { impl } = makeFakeGitHub();
    const result = await Effect.runPromise(impl.defaultBaseBranch("/repo"));
    expect(result).toBe("main");
  });

  it("defaultBaseBranch returns configured branch", async () => {
    const { impl } = makeFakeGitHub();
    impl.setDefaultBranch("develop");
    const result = await Effect.runPromise(impl.defaultBaseBranch("/repo"));
    expect(result).toBe("develop");
  });

  it("findPullRequestForBranch returns null when no PR seeded", async () => {
    const { impl } = makeFakeGitHub();
    const result = await Effect.runPromise(
      impl.findPullRequestForBranch(
        "my-branch" as Parameters<typeof impl.findPullRequestForBranch>[0],
        "/repo",
      ),
    );
    expect(result).toBeNull();
    expect(impl.calls).toContainEqual({
      method: "findPullRequestForBranch",
      branch: "my-branch",
      repo: "/repo",
    });
  });

  it("findPullRequestForBranch returns seeded URL", async () => {
    const { impl } = makeFakeGitHub();
    impl.seedExistingPr("feature-branch", "https://github.com/owner/repo/pull/42");
    const result = await Effect.runPromise(
      impl.findPullRequestForBranch(
        "feature-branch" as Parameters<typeof impl.findPullRequestForBranch>[0],
        "/repo",
      ),
    );
    expect(result).toBe("https://github.com/owner/repo/pull/42");
  });

  it("createPullRequest returns configured URL", async () => {
    const { impl } = makeFakeGitHub();
    impl.setCreatedPrUrl("https://github.com/owner/repo/pull/99");
    const result = await Effect.runPromise(
      impl.createPullRequest({
        branch: "my-branch" as Parameters<typeof impl.createPullRequest>[0]["branch"],
        base: "main",
        title: "My PR",
        bodyFile: "/tmp/body.md",
        repo: "/repo",
      }),
    );
    expect(result).toBe("https://github.com/owner/repo/pull/99");
    expect(impl.calls).toContainEqual({
      method: "createPullRequest",
      branch: "my-branch",
      base: "main",
      title: "My PR",
      bodyFile: "/tmp/body.md",
      repo: "/repo",
    });
  });

  it("createPullRequest fails with configured error via failNextCreatePr", async () => {
    const { impl } = makeFakeGitHub();
    impl.failNextCreatePr("authentication required");
    await expect(
      Effect.runPromise(
        impl.createPullRequest({
          branch: "my-branch" as Parameters<typeof impl.createPullRequest>[0]["branch"],
          base: "main",
          title: "My PR",
          bodyFile: "/tmp/body.md",
          repo: "/repo",
        }),
      ),
    ).rejects.toThrow();
  });

  it("failNextCreatePr only fails once", async () => {
    const { impl } = makeFakeGitHub();
    impl.failNextCreatePr("error");
    await expect(
      Effect.runPromise(
        impl.createPullRequest({
          branch: "my-branch" as Parameters<typeof impl.createPullRequest>[0]["branch"],
          base: "main",
          title: "My PR",
          bodyFile: "/tmp/body.md",
          repo: "/repo",
        }),
      ),
    ).rejects.toThrow();
    const result = await Effect.runPromise(
      impl.createPullRequest({
        branch: "my-branch" as Parameters<typeof impl.createPullRequest>[0]["branch"],
        base: "main",
        title: "My PR",
        bodyFile: "/tmp/body.md",
        repo: "/repo",
      }),
    );
    expect(result).toBe(impl.createdPrUrl);
  });
});
