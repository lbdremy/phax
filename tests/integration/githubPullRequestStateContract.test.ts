import { Effect, Result } from "effect";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeGitHubLayer } from "../../src/infra/github.js";
import {
  GitHub,
  GitHubError,
  type GitHubOps,
  type PullRequestState,
} from "../../src/ports/github.js";

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

function realState(): Promise<Result.Result<PullRequestState, GitHubError>> {
  return Effect.runPromise(
    Effect.result(
      Effect.flatMap(GitHub, (gh: GitHubOps) =>
        gh.pullRequestState({ pullRequest: PR, repo: binDir }),
      ).pipe(Effect.provide(NodeGitHubLayer)),
    ),
  );
}

// The failure the contract promises: a GitHubError, whose message holds `part`.
function expectGitHubError(result: Result.Result<PullRequestState, unknown>, part = ""): void {
  const error = Result.flip(result).pipe(Result.getOrNull);
  expect(error).toBeInstanceOf(GitHubError);
  expect((error as GitHubError).message).toContain(part);
}

const GH_STATES = { open: "OPEN", merged: "MERGED", closed: "CLOSED" } as const;

// The two implementations, each set up to answer a state or to fail.
const implementations = [
  {
    name: "the gh adapter",
    answers: (state: PullRequestState) => {
      // Exits 9 unless the arguments are exactly: pr view <url> --json state.
      fakeGh(
        [
          `[ "$*" = "pr view ${PR} --json state" ] || exit 9`,
          `echo '{"state":"${GH_STATES[state]}"}'`,
        ].join("\n"),
      );
      return realState();
    },
    fails: () => {
      fakeGh("echo 'HTTP 404: not found' >&2\nexit 1");
      return realState();
    },
  },
  {
    name: "the fake",
    answers: (state: PullRequestState) => {
      const { impl } = makeFakeGitHub();
      impl.setPullRequestState(state);
      return Effect.runPromise(
        Effect.result(impl.pullRequestState({ pullRequest: PR, repo: binDir })),
      );
    },
    fails: () => {
      const { impl } = makeFakeGitHub();
      impl.failNextPullRequestState("HTTP 404: not found");
      return Effect.runPromise(
        Effect.result(impl.pullRequestState({ pullRequest: PR, repo: binDir })),
      );
    },
  },
];

describe.each(implementations)("pullRequestState contract: $name", ({ answers, fails }) => {
  it.each(["open", "merged", "closed"] as const)("answers %s as the host reports it", async (s) => {
    expect(await answers(s)).toEqual(Result.succeed(s));
  });

  it("fails with a GitHubError carrying the host's stderr when it cannot answer", async () => {
    const error = Result.flip(await fails()).pipe(Result.getOrNull);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).stderr).toContain("HTTP 404: not found");
  });
});

describe("NodeGitHubLayer.pullRequestState refusals", () => {
  it("is a GitHubError when gh answers something that is not JSON", async () => {
    fakeGh("echo 'MERGED'");
    expectGitHubError(await realState(), "did not answer JSON");
  });

  it("is a GitHubError when the schema refuses a state it does not know", async () => {
    fakeGh(`echo '{"state":"DRAFT"}'`);
    expectGitHubError(await realState(), "unexpected shape");
  });

  it("is a GitHubError when the answer carries a key the schema does not know", async () => {
    fakeGh(`echo '{"state":"OPEN","url":"${PR}"}'`);
    expectGitHubError(await realState(), "unexpected shape");
  });
});

describe("FakeGitHubImpl.pullRequestState", () => {
  it("records the call and reads open until told otherwise", async () => {
    const { impl } = makeFakeGitHub();
    expect(await Effect.runPromise(impl.pullRequestState({ pullRequest: PR, repo: "/r" }))).toBe(
      "open",
    );
    expect(impl.calls).toEqual([{ method: "pullRequestState", pullRequest: PR, repo: "/r" }]);
  });
});
