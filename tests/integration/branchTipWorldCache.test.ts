import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECORDS_BRANCH_NAME } from "../../src/app/writeRecord.js";
import {
  BRANCH_REF,
  branchTipBuildPath,
  buildBranchTipWorld,
  buildBranchTipWorldAt,
  git,
  putBranchAhead,
  withGitTrace,
  type BranchTipWorld,
} from "../fixtures/records/branchTipRepos.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { removeTempDir } from "../helpers/tempGit.js";

// The branch-tip world is built once per test file and copied for every test: spec
// test-worlds-built-once §5.1 to §5.9 (ac-built-once, ac-identical, ac-deterministic, ac-guard,
// ac-isolated, ac-bulk-count, ac-env, ac-git-isolation). Each test that needs a cache entry of its
// own in this file takes its own `remoteRecords`.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

const RITA = "Rita Recorder|rita@records.test|Rita Recorder|rita@records.test";
const WORLD_VARIABLES = [
  "GIT_SSH_COMMAND",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

const worlds: BranchTipWorld[] = [];
const scratchDirs: string[] = [];

function track(world: BranchTipWorld): BranchTipWorld {
  worlds.push(world);
  return world;
}

/** A path under a scratch directory of the test's own, which does not exist yet. */
function newWorldPath(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "phax-branch-tip-test-")));
  scratchDirs.push(dir);
  return join(dir, "world");
}

function cleanupAll(): void {
  for (const world of worlds.splice(0).toReversed()) world.cleanup();
  for (const dir of scratchDirs.splice(0)) removeTempDir(dir);
}

function envOf(names: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/** The world's repositories, relative to its base: the bare remote, the clones, the source. */
function repositories(base: string): string[] {
  const repos = ["remote.git", "upstream", "source"];
  if (existsSync(join(base, "state", "records", "branch-tip"))) {
    repos.push(join("state", "records", "branch-tip"));
  }
  return repos;
}

function configFile(repo: string): string {
  return existsSync(join(repo, ".git")) ? join(repo, ".git", "config") : join(repo, "config");
}

function filesOutsideGit(base: string, dir: string, into: Record<string, string>): void {
  const entries: Dirent[] = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const rel = relative(base, path);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || rel === "remote.git") continue;
      into[`${rel}/`] = "<dir>";
      filesOutsideGit(base, path, into);
    } else {
      into[rel] = readFileSync(path, "utf8");
    }
  }
}

/** Every repository's refs, HEAD and config, and every file outside the repositories' git data. */
function snapshot(world: BranchTipWorld) {
  const repos = Object.fromEntries(
    repositories(world.base).map((name) => {
      const repo = join(world.base, name);
      return [
        name,
        {
          refs: git(["for-each-ref", "--format=%(refname) %(objectname)"], repo),
          head: git(["symbolic-ref", "HEAD"], repo),
          config: readFileSync(configFile(repo), "utf8"),
        },
      ];
    }),
  );
  const files: Record<string, string> = {};
  filesOutsideGit(world.base, world.base, files);
  return { repos, files };
}

/** Every commit of every repository: author and committer, and their dates. */
function commitsOf(world: BranchTipWorld): Record<string, string[]> {
  return Object.fromEntries(
    repositories(world.base).map((name) => [
      name,
      git(["log", "--all", "--format=%an|%ae|%cn|%ce|%aI|%cI"], join(world.base, name)).split("\n"),
    ]),
  );
}

function isGitCommand(words: readonly string[], name: string): boolean {
  return (words[0] === "git" && words[1] === name) || words[0] === `git-${name}`;
}

describe("a branch-tip world copied from the file's cached world", () => {
  let restoreGit: () => void;

  beforeEach(() => {
    restoreGit = isolateGit();
  });

  afterEach(() => {
    cleanupAll();
    restoreGit();
  });

  // ac-built-once
  let builtOnceTip: string | undefined;

  it("builds the 300-record world for the first request of the file", async () => {
    const world = track(await buildBranchTipWorld({ remoteRecords: 300 }));
    builtOnceTip = world.remoteTip();
    expect(world.remoteKeys).toHaveLength(300);
  });

  it("builds no remote and writes no record for a second request with the same parameters", async () => {
    const { value: world, commands } = await withGitTrace(() =>
      buildBranchTipWorld({ remoteRecords: 300 }),
    );
    track(world);
    expect(commands.length).toBeGreaterThan(0);
    const offending = commands.filter(
      (words) =>
        (isGitCommand(words, "init") && words.includes("--bare")) ||
        isGitCommand(words, "fast-import") ||
        isGitCommand(words, "commit-tree") ||
        isGitCommand(words, "hash-object"),
    );
    expect(offending).toEqual([]);
    expect(builtOnceTip).toBeDefined();
    expect(world.remoteTip()).toBe(builtOnceTip);
  });

  // ac-identical
  it("answers a copy identical to a fresh build at the same path", async () => {
    const path = newWorldPath();
    const fresh = await buildBranchTipWorldAt(path, { remoteRecords: 5, fresh: true });
    const freshSnapshot = snapshot(fresh);
    fresh.cleanup();
    expect(existsSync(path)).toBe(false);

    const copy = track(await buildBranchTipWorldAt(path, { remoteRecords: 5, fresh: false }));
    expect(snapshot(copy)).toEqual(freshSnapshot);
    expect(copy.remoteKeys).toEqual(fresh.remoteKeys);
  });

  // ac-deterministic
  it("builds the same commits twice, each with the fixture's identity and a fixed date", async () => {
    const path = newWorldPath();
    const first = await buildBranchTipWorldAt(path, { remoteRecords: 3, fresh: true });
    const firstRefs = snapshot(first).repos;
    const firstCommits = commitsOf(first);
    first.cleanup();
    const second = track(await buildBranchTipWorldAt(path, { remoteRecords: 3, fresh: true }));
    expect(snapshot(second).repos).toEqual(firstRefs);
    expect(commitsOf(second)).toEqual(firstCommits);

    const fixedDates = new Set(
      [0, 1, 2, 3].map((offset) => new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).getTime()),
    );
    for (const [repo, lines] of Object.entries(firstCommits)) {
      expect(lines.length, repo).toBeGreaterThan(0);
      for (const line of lines) {
        const [an, ae, cn, ce, ad, cd] = line.split("|");
        expect([an, ae, cn, ce].join("|"), repo).toBe(RITA);
        expect(fixedDates.has(new Date(ad ?? "").getTime()), `${repo}: ${line}`).toBe(true);
        expect(fixedDates.has(new Date(cd ?? "").getTime()), `${repo}: ${line}`).toBe(true);
      }
    }
  });

  // ac-guard
  it("fails a copy of a cached world holding its build path, naming the file and the path", async () => {
    const buildPath = await branchTipBuildPath({ remoteRecords: 7 });
    const plantedDir = join(buildPath, "source");
    mkdirSync(plantedDir);
    writeFileSync(join(plantedDir, "planted.txt"), `${buildPath}\n`);
    const privateTmp = realpathSync(mkdtempSync(join(tmpdir(), "phax-branch-tip-guard-")));
    const savedTmp = process.env["TMPDIR"];
    const before = envOf(WORLD_VARIABLES);
    let message = "";
    try {
      process.env["TMPDIR"] = privateTmp;
      await buildBranchTipWorld({ remoteRecords: 7 }).then(
        (world) => {
          track(world);
          throw new Error("the copy was accepted");
        },
        (error: unknown) => {
          message = error instanceof Error ? error.message : String(error);
        },
      );
      expect(readdirSync(privateTmp)).toEqual([]);
    } finally {
      if (savedTmp === undefined) delete process.env["TMPDIR"];
      else process.env["TMPDIR"] = savedTmp;
      removeTempDir(privateTmp);
      rmSync(plantedDir, { recursive: true, force: true });
    }
    expect(message).toContain("source/planted.txt");
    expect(message).toContain(buildPath);
    expect(envOf(WORLD_VARIABLES)).toEqual(before);
  });

  // ac-isolated
  let isolatedBuildTip: string | undefined;

  it("lets a test push records to its own copy's remote", async () => {
    const world = track(await buildBranchTipWorld({ remoteRecords: 6 }));
    isolatedBuildTip = world.remoteTip();
    const ahead = await putBranchAhead(world);
    git(["push", "-q", "origin", RECORDS_BRANCH_NAME], world.clonePath);
    expect(world.remoteTip()).toBe(ahead.localTip);
    expect(world.remoteTip()).not.toBe(isolatedBuildTip);
  });

  it("keeps another test's pushed records out of a later copy and out of the cached world", async () => {
    const world = track(await buildBranchTipWorld({ remoteRecords: 6 }));
    expect(isolatedBuildTip).toBeDefined();
    expect(world.remoteTip()).toBe(isolatedBuildTip);
    const buildPath = await branchTipBuildPath({ remoteRecords: 6 });
    expect(git(["rev-parse", BRANCH_REF], join(buildPath, "remote.git"))).toBe(isolatedBuildTip);
  });

  // ac-bulk-count
  it("starts the same number of git processes for a world of 4 records as for one of 300", async () => {
    const counts: number[] = [];
    for (const remoteRecords of [4, 300]) {
      const path = newWorldPath();
      const { value: world, commands } = await withGitTrace(() =>
        buildBranchTipWorldAt(path, { remoteRecords, fresh: true }),
      );
      track(world);
      expect(world.remoteKeys).toHaveLength(remoteRecords);
      expect(commands.filter((words) => isGitCommand(words, "fast-import"))).toHaveLength(1);
      counts.push(commands.length);
    }
    expect(counts[1]).toBe(counts[0]);
  });

  // ac-env
  it("sets the copy's ssh command and identity, works with phax records status, and puts the test's back", async () => {
    const saved = envOf(["GIT_SSH_COMMAND", "GIT_AUTHOR_NAME"]);
    try {
      process.env["GIT_SSH_COMMAND"] = "the-test-ssh-command";
      process.env["GIT_AUTHOR_NAME"] = "Tess Tester";
      const world = await buildBranchTipWorld();
      try {
        expect(process.env["GIT_SSH_COMMAND"]).toBe(join(world.base, "fake-ssh.sh"));
        expect(process.env["GIT_AUTHOR_NAME"]).toBe("Rita Recorder");
        await putBranchAhead(world, { localOnly: 0 });
        const result = spawnSync("tsx", [mainTs, "records", "status", "--json"], {
          cwd: world.sourceRepo,
          encoding: "utf8",
          env: phaxHomeEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        expect(result.status, result.stderr).toBe(0);
        const status: unknown = JSON.parse(result.stdout);
        expect(status).toMatchObject({ branch: { remoteTip: world.remoteTip() } });
      } finally {
        world.cleanup();
      }
      expect(process.env["GIT_SSH_COMMAND"]).toBe("the-test-ssh-command");
      expect(process.env["GIT_AUTHOR_NAME"]).toBe("Tess Tester");
    } finally {
      restoreEnv(saved);
    }
  });
});

describe("a branch-tip world built under a person's global git configuration", () => {
  afterEach(() => {
    cleanupAll();
  });

  // ac-git-isolation
  it("carries none of its identity or default branch", async () => {
    const saved = envOf(["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"]);
    const configDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-branch-tip-gitconfig-")));
    try {
      const globalConfig = join(configDir, "gitconfig");
      writeFileSync(
        globalConfig,
        "[user]\n\tname = Someone Else\n\temail = someone@else.test\n[init]\n\tdefaultBranch = trunk\n",
      );
      process.env["GIT_CONFIG_GLOBAL"] = globalConfig;
      process.env["GIT_CONFIG_NOSYSTEM"] = "1";
      // Parameters no earlier test of this file used: the cached world is built here.
      const world = track(await buildBranchTipWorld({ remoteRecords: 9 }));
      for (const [repo, lines] of Object.entries(commitsOf(world))) {
        expect(lines.length, repo).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line.split("|").slice(0, 4).join("|"), `${repo}: ${line}`).toBe(RITA);
        }
      }
      for (const repo of repositories(world.base)) {
        expect(git(["symbolic-ref", "HEAD"], join(world.base, repo)), repo).toBe("refs/heads/main");
      }
    } finally {
      cleanupAll();
      restoreEnv(saved);
      removeTempDir(configDir);
    }
  });
});
