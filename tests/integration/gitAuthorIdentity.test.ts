import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Git } from "../../src/ports/git.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The Node git adapter's `authorIdentity`, against a made-up temp repository.
// The global and system git configs and the caller's author variables are kept
// out through the environment, so the machine's own identity never leaks in.

let repoDir: string;
let configDir: string;

function git(args: readonly string[]): void {
  execFileSync("git", args, { cwd: repoDir, stdio: "pipe" });
}

function authorIdentity() {
  return Effect.runPromise(
    Effect.either(
      Effect.flatMap(Git, (ops) => ops.authorIdentity(repoDir)).pipe(Effect.provide(NodeGitLayer)),
    ),
  );
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "phax-git-author-config-"));
  const globalConfig = join(configDir, "gitconfig");
  writeFileSync(globalConfig, "");
  vi.stubEnv("HOME", configDir);
  vi.stubEnv("XDG_CONFIG_HOME", join(configDir, "xdg"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_AUTHOR_NAME", undefined);
  vi.stubEnv("GIT_AUTHOR_EMAIL", undefined);
  repoDir = mkdtempSync(join(tmpdir(), "phax-git-author-"));
  git(["init", "-q", "-b", "main"]);
  disableGitAutoMaintenance(repoDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(repoDir);
  removeTempDir(configDir);
});

const ADA = { name: "Ada Example", email: "ada@example.test" };
const GRACE = { name: "Grace Example", email: "grace@example.test" };
const LIN = { name: "Lin Example", email: "lin@example.test" };

describe("Git authorIdentity (Node adapter)", () => {
  it.each([
    {
      setup: "name and email in the repository's config",
      config: ADA,
      env: {},
      expected: ADA,
    },
    {
      setup: "both author variables over the config",
      config: ADA,
      env: { GIT_AUTHOR_NAME: GRACE.name, GIT_AUTHOR_EMAIL: GRACE.email },
      expected: GRACE,
    },
    {
      setup: "one variable and the other field from the config",
      config: ADA,
      env: { GIT_AUTHOR_EMAIL: GRACE.email },
      expected: { name: ADA.name, email: GRACE.email },
    },
    {
      setup: "both variables and no config",
      config: {},
      env: { GIT_AUTHOR_NAME: GRACE.name, GIT_AUTHOR_EMAIL: GRACE.email },
      expected: GRACE,
    },
    {
      setup: "empty variables falling back to the config",
      config: ADA,
      env: { GIT_AUTHOR_NAME: "", GIT_AUTHOR_EMAIL: "" },
      expected: ADA,
    },
    {
      setup: "author.name and author.email over user.*",
      config: { ...ADA, authorName: GRACE.name, authorEmail: GRACE.email },
      env: {},
      expected: GRACE,
    },
    {
      setup: "author.email alone over user.email, user.name kept",
      config: { ...ADA, authorEmail: GRACE.email },
      env: {},
      expected: { name: ADA.name, email: GRACE.email },
    },
    {
      setup: "author.* and no user.*",
      config: { authorName: GRACE.name, authorEmail: GRACE.email },
      env: {},
      expected: GRACE,
    },
    {
      setup: "the author variables over author.*",
      config: { authorName: GRACE.name, authorEmail: GRACE.email },
      env: { GIT_AUTHOR_NAME: LIN.name, GIT_AUTHOR_EMAIL: LIN.email },
      expected: LIN,
    },
    { setup: "no name", config: { email: ADA.email }, env: {}, expected: null },
    { setup: "no email", config: { name: ADA.name }, env: {}, expected: null },
    { setup: "an empty email", config: { name: ADA.name, email: "" }, env: {}, expected: null },
    { setup: "nothing set", config: {}, env: {}, expected: null },
  ] as const)("returns the identity for $setup", async ({ config, env, expected }) => {
    const fields: Readonly<Record<string, string | undefined>> = config;
    if (fields["name"] !== undefined) git(["config", "--local", "user.name", fields["name"]]);
    if (fields["email"] !== undefined) git(["config", "--local", "user.email", fields["email"]]);
    if (fields["authorName"] !== undefined) {
      git(["config", "--local", "author.name", fields["authorName"]]);
    }
    if (fields["authorEmail"] !== undefined) {
      git(["config", "--local", "author.email", fields["authorEmail"]]);
    }
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    expect(await authorIdentity()).toEqual(Either.right(expected));
  });

  it("fails with a GitError when git cannot read the repository's config", async () => {
    writeFileSync(join(repoDir, ".git", "config"), "[user\n\tname = Ada Example\n");
    expect(Either.isLeft(await authorIdentity())).toBe(true);
  });
});
