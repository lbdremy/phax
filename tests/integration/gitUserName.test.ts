import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git, GitError } from "../../src/ports/git.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The Node git adapter's `userName`, against a made-up temp repository. The
// global and system git configs are kept out through the environment, so the
// machine's own identity never leaks in.

let repoDir: string;
let configDir: string;

function git(args: readonly string[]): void {
  execFileSync("git", args, { cwd: repoDir, stdio: "pipe" });
}

function userName(repo: string = repoDir) {
  return Effect.runPromise(
    Effect.either(
      Effect.flatMap(Git, (ops) => ops.userName(repo)).pipe(Effect.provide(NodeGitLayer)),
    ),
  );
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "phax-git-user-config-"));
  const globalConfig = join(configDir, "gitconfig");
  writeFileSync(globalConfig, "");
  vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  repoDir = mkdtempSync(join(tmpdir(), "phax-git-user-name-"));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

describe("Git userName (Node adapter)", () => {
  it("returns the user.name configured in the repository", async () => {
    git(["config", "--local", "user.name", "Ada Lovelace"]);
    expect(await userName()).toEqual(Either.right("Ada Lovelace"));
  });

  it("returns null when user.name is unset", async () => {
    expect(await userName()).toEqual(Either.right(null));
  });

  it("returns null when user.name is set but empty", async () => {
    git(["config", "--local", "user.name", ""]);
    expect(await userName()).toEqual(Either.right(null));
  });

  it("fails with a GitError when git cannot read the repository's config", async () => {
    writeFileSync(join(repoDir, ".git", "config"), "[user\n\tname = Ada Lovelace\n");
    const result = await userName();
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(GitError);
  });
});
