import { Effect } from "effect";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisibilityReading } from "../../src/domain/records/destination.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeGitHubLayer } from "../../src/infra/github.js";
import { GitHub, type GitHubOps } from "../../src/ports/github.js";

// The visibility contract: a failing `gh repo view` gives an unknown
// visibility carrying gh's first stderr line, never a guess. One suite runs
// against the real adapter (a made-up `gh` first on PATH) and the fake.
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

function realVisibility(): Promise<VisibilityReading> {
  return Effect.runPromise(
    Effect.flatMap(GitHub, (gh: GitHubOps) => gh.visibility(binDir)).pipe(
      Effect.provide(NodeGitHubLayer),
    ),
  );
}

const implementations = [
  {
    name: "the gh adapter",
    answers: (visibility: "PUBLIC" | "PRIVATE") => {
      fakeGh(`echo '${visibility}'`);
      return realVisibility();
    },
    fails: (firstLine: string) => {
      fakeGh(`echo '${firstLine}' >&2\necho 'a second line' >&2\nexit 1`);
      return realVisibility();
    },
  },
  {
    name: "the fake",
    answers: (visibility: "PUBLIC" | "PRIVATE") => {
      const { impl } = makeFakeGitHub();
      impl.setVisibility(visibility === "PUBLIC" ? "public" : "private");
      return Effect.runPromise(impl.visibility(binDir));
    },
    fails: (firstLine: string) => {
      const { impl } = makeFakeGitHub();
      impl.failVisibility(firstLine);
      return Effect.runPromise(impl.visibility(binDir));
    },
  },
];

describe.each(implementations)("visibility contract: $name", ({ answers, fails }) => {
  it("reads a public repository with no gh error", async () => {
    expect(await answers("PUBLIC")).toEqual({ visibility: "public", ghError: null });
  });

  it("reads a private repository with no gh error", async () => {
    expect(await answers("PRIVATE")).toEqual({ visibility: "private", ghError: null });
  });

  it("keeps gh's network failure line", async () => {
    expect(await fails("error connecting to api.github.com")).toEqual({
      visibility: "unknown",
      ghError: "error connecting to api.github.com",
    });
  });

  it("keeps gh's auth failure line", async () => {
    expect(await fails("To get started with GitHub CLI, please run:  gh auth login")).toEqual({
      visibility: "unknown",
      ghError: "To get started with GitHub CLI, please run:  gh auth login",
    });
  });

  it("keeps gh's no-remote failure line", async () => {
    expect(await fails("no git remotes found")).toEqual({
      visibility: "unknown",
      ghError: "no git remotes found",
    });
  });
});
