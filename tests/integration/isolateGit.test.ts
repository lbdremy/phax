import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isolateGit } from "../helpers/isolateGit.js";
import { removeTempDir } from "../helpers/tempGit.js";

// isolateGit keeps git away from the person's configuration and identity, and
// puts the environment back once every isolation is restored. Made-up values:
// Grace Hopper's identity and a global config at /example/gitconfig.

const KEYS = [
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "XDG_CONFIG_HOME",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

const PLANTED: Record<(typeof KEYS)[number], string> = {
  GIT_CONFIG_GLOBAL: "/example/gitconfig",
  GIT_CONFIG_NOSYSTEM: "0",
  XDG_CONFIG_HOME: "/example/xdg",
  GIT_AUTHOR_NAME: "Grace Hopper",
  GIT_AUTHOR_EMAIL: "grace@example.test",
  GIT_COMMITTER_NAME: "Grace Hopper",
  GIT_COMMITTER_EMAIL: "grace@example.test",
};

let before: Record<string, string | undefined>;
let repo: string;

beforeEach(() => {
  before = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) process.env[key] = PLANTED[key];
  repo = realpathSync(mkdtempSync(join(tmpdir(), "phax-isolate-git-test-")));
});

afterEach(() => {
  for (const key of KEYS) {
    const value = before[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  removeTempDir(repo);
});

const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, stdio: "pipe", env: process.env }).toString().trim();

describe("isolateGit", () => {
  it("gives git an empty global config, no system config and no identity from the environment", () => {
    const restore = isolateGit();
    try {
      expect(process.env["GIT_CONFIG_NOSYSTEM"]).toBe("1");
      for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME"]) {
        expect(process.env[key]).toBeUndefined();
      }
      gitIn(repo, "init", "--quiet");
      expect(gitIn(repo, "config", "--global", "--list")).toBe("");
      expect(gitIn(repo, "config", "--show-origin", "--list")).not.toContain("/example/");
    } finally {
      restore();
    }
  });

  it("puts the environment back once the last of nested isolations is restored, in any order", () => {
    const first = isolateGit();
    const second = isolateGit();
    first();
    expect(process.env["GIT_AUTHOR_NAME"]).toBeUndefined();
    second();
    for (const key of KEYS) expect(process.env[key]).toBe(PLANTED[key]);
    // Restoring twice changes nothing.
    first();
    expect(process.env["GIT_CONFIG_GLOBAL"]).toBe(PLANTED.GIT_CONFIG_GLOBAL);
  });
});
