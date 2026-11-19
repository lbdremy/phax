import { Effect, Result } from "effect";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeGitHubLayer } from "../../src/infra/github.js";
import { GitHub, GitHubError, type GitHubOps } from "../../src/ports/github.js";

// The real adapter runs `gh`; a made-up `gh` script first on PATH answers it.
let binDir: string;

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), "phax-fake-gh-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(binDir, { recursive: true, force: true });
});

function fakeGh(script: string): void {
  const path = join(binDir, "gh");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  vi.stubEnv("PATH", `${binDir}:${process.env["PATH"] ?? "/usr/bin:/bin"}`);
}

const PR = "https://github.com/example/repo/pull/7";

function realComment(body: string): Promise<Result.Result<string, GitHubError>> {
  return Effect.runPromise(
    Effect.result(
      Effect.flatMap(GitHub, (gh: GitHubOps) =>
        gh.commentOnPullRequest({ pullRequest: PR, body, repo: binDir }),
      ).pipe(Effect.provide(NodeGitHubLayer)),
    ),
  );
}

const implementations = [
  {
    name: "the gh adapter",
    answers: () => {
      fakeGh(`echo '${PR}#issuecomment-1'`);
      return realComment("hello");
    },
    fails: () => {
      fakeGh("echo 'could not comment' >&2\nexit 1");
      return realComment("hello");
    },
  },
  {
    name: "the fake",
    answers: () => {
      const { impl } = makeFakeGitHub();
      return Effect.runPromise(
        Effect.result(impl.commentOnPullRequest({ pullRequest: PR, body: "hello", repo: binDir })),
      );
    },
    fails: () => {
      const { impl } = makeFakeGitHub();
      impl.failNextComment("could not comment");
      return Effect.runPromise(
        Effect.result(impl.commentOnPullRequest({ pullRequest: PR, body: "hello", repo: binDir })),
      );
    },
  },
];

describe.each(implementations)("commentOnPullRequest contract: $name", ({ answers, fails }) => {
  it("answers a URL that starts with the pull request's URL", async () => {
    const result = await answers();
    expect(Result.isSuccess(result)).toBe(true);
    expect(Result.getOrNull(result)?.startsWith(PR)).toBe(true);
  });

  it("fails with a GitHubError when the host fails", async () => {
    const error = Result.flip(await fails()).pipe(Result.getOrNull);
    expect(error).toBeInstanceOf(GitHubError);
  });
});

describe("NodeGitHubLayer.commentOnPullRequest", () => {
  it("passes the body verbatim as one argument, with no shell", async () => {
    const body = "line one\n`code` $(echo injected)";
    // Exits 9 unless the arguments are exactly: pr comment <url> --body <body>.
    fakeGh(
      [
        `[ "$#" = 5 ] || exit 9`,
        `[ "$1" = "pr" ] || exit 9`,
        `[ "$2" = "comment" ] || exit 9`,
        `[ "$3" = "${PR}" ] || exit 9`,
        `[ "$4" = "--body" ] || exit 9`,
        `expected=$(printf 'line one\\n\`code\` $(echo injected)')`,
        `[ "$5" = "$expected" ] || exit 9`,
        `echo '${PR}#issuecomment-1'`,
      ].join("\n"),
    );
    expect(await realComment(body)).toEqual(Result.succeed(`${PR}#issuecomment-1`));
  });

  it("answers the pull request's URL when gh prints nothing", async () => {
    fakeGh("exit 0");
    expect(await realComment("hello")).toEqual(Result.succeed(PR));
  });

  it("carries gh's stderr in the GitHubError", async () => {
    fakeGh("echo 'HTTP 403: forbidden' >&2\nexit 1");
    const error = Result.flip(await realComment("hello")).pipe(Result.getOrNull);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).stderr).toContain("HTTP 403: forbidden");
  });
});

describe("FakeGitHubImpl.commentOnPullRequest", () => {
  it("records the call with its body and numbers its comments", async () => {
    const { impl } = makeFakeGitHub();
    const first = await Effect.runPromise(
      impl.commentOnPullRequest({ pullRequest: PR, body: "a\nb", repo: "/r" }),
    );
    const second = await Effect.runPromise(
      impl.commentOnPullRequest({ pullRequest: PR, body: "c", repo: "/r" }),
    );
    expect(first).toBe(`${PR}#issuecomment-1`);
    expect(second).toBe(`${PR}#issuecomment-2`);
    expect(impl.calls).toEqual([
      { method: "commentOnPullRequest", pullRequest: PR, body: "a\nb", repo: "/r" },
      { method: "commentOnPullRequest", pullRequest: PR, body: "c", repo: "/r" },
    ]);
  });
});
