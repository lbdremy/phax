import { Effect, Either } from "effect";
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

function realRepoWebUrl(): Promise<Either.Either<string, GitHubError>> {
  return Effect.runPromise(
    Effect.either(
      Effect.flatMap(GitHub, (gh: GitHubOps) => gh.repoWebUrl(binDir)).pipe(
        Effect.provide(NodeGitHubLayer),
      ),
    ),
  );
}

// The failure the contract promises: a GitHubError, whose message holds `part`.
function expectGitHubError(result: Either.Either<string, unknown>, part = ""): void {
  const error = Either.flip(result).pipe(Either.getOrNull);
  expect(error).toBeInstanceOf(GitHubError);
  expect((error as GitHubError).message).toContain(part);
}

// The two implementations, each set up to answer a url or to fail.
const implementations = [
  {
    name: "the gh adapter",
    answers: (url: string) => {
      fakeGh(`[ "$*" = "repo view --json url" ] || exit 9\necho '{"url":"${url}"}'`);
      return realRepoWebUrl();
    },
    fails: () => {
      fakeGh("echo 'no git remotes found' >&2\nexit 1");
      return realRepoWebUrl();
    },
  },
  {
    name: "the fake",
    answers: (url: string) => {
      const { impl } = makeFakeGitHub();
      impl.setWebUrl(url);
      return Effect.runPromise(Effect.either(impl.repoWebUrl(binDir)));
    },
    fails: () => {
      const { impl } = makeFakeGitHub();
      impl.failNextRepoWebUrl("no git remotes found");
      return Effect.runPromise(Effect.either(impl.repoWebUrl(binDir)));
    },
  },
];

describe.each(implementations)("repoWebUrl contract: $name", ({ answers, fails }) => {
  it("returns the repository's web URL", async () => {
    expect(await answers("https://github.com/example/repo")).toEqual(
      Either.right("https://github.com/example/repo"),
    );
  });

  it("fails with a GitHubError when the host cannot answer", async () => {
    expectGitHubError(await fails());
  });
});

describe("NodeGitHubLayer.repoWebUrl refusals", () => {
  it("is a GitHubError when gh answers something that is not JSON", async () => {
    fakeGh("echo 'https://github.com/example/repo'");
    expectGitHubError(await realRepoWebUrl(), "did not answer JSON");
  });

  it("is a GitHubError when the schema refuses the answer", async () => {
    fakeGh(`echo '{"url":"http://github.com/example/repo"}'`);
    expectGitHubError(await realRepoWebUrl(), "unexpected shape");
  });
});
