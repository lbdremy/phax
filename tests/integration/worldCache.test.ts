import { GIT_BOUND_MS, boundedOutput, boundedSpawn } from "../helpers/boundedSpawn.js";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertNoBuildPath, cachedWorld, copyWorld } from "../fixtures/worlds/worldCache.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The per-file world cache, the directory copy and the copy guard, with real git and real files.
// The cache is per test file, so every test asks for a world name of its own.

const REPO_ROOT = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));

let restoreGit: () => void;
let temp: string[];
let counter = 0;

beforeEach(() => {
  restoreGit = isolateGit();
  temp = [];
});

afterEach(() => {
  for (const dir of temp) removeTempDir(dir);
  restoreGit();
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temp.push(dir);
  return dir;
}

function uniqueName(label: string): string {
  counter += 1;
  return `${label}-${counter}`;
}

function git(args: readonly string[], cwd: string): string {
  return boundedOutput("git", [...args], { boundMs: GIT_BOUND_MS, cwd }).trim();
}

/** A world of one plain file, an executable script and a bare repository holding one commit. */
async function buildSample(buildPath: string): Promise<void> {
  mkdirSync(join(buildPath, "state"), { recursive: true });
  writeFileSync(join(buildPath, "note.md"), "A note.\n");
  writeFileSync(join(buildPath, "state", "run.json"), '{"id":"run-1"}\n');
  writeFileSync(join(buildPath, "tool.sh"), "#!/bin/sh\necho tool\n");
  chmodSync(join(buildPath, "tool.sh"), 0o755);
  const repo = join(buildPath, "remote.git");
  git(["init", "-q", "--bare", "-b", "main", repo], tmpdir());
  disableGitAutoMaintenance(repo);
  const work = tempDir("phax-world-cache-test-work-");
  git(["init", "-q", "-b", "main", work], tmpdir());
  disableGitAutoMaintenance(work);
  git(["config", "--local", "user.name", "Wanda World"], work);
  git(["config", "--local", "user.email", "wanda@world.test"], work);
  writeFileSync(join(work, "file.txt"), "content\n");
  git(["add", "file.txt"], work);
  git(["commit", "-q", "-m", "seed"], work);
  git(["push", "-q", repo, "main"], work);
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("cachedWorld", () => {
  it("builds a name once and answers the same build path to every request", async () => {
    const name = uniqueName("once");
    let calls = 0;
    const build = async (buildPath: string): Promise<void> => {
      calls += 1;
      await buildSample(buildPath);
    };
    const first = await cachedWorld(name, build);
    const second = await cachedWorld(name, build);
    expect(second).toBe(first);
    expect(calls).toBe(1);
    expect(existsSync(join(first, "note.md"))).toBe(true);
    expect(first.endsWith(`/${name}`)).toBe(true);
    expect(first).toContain("phax-world-cache-");
  });

  it("shares one build between concurrent requests", async () => {
    const name = uniqueName("concurrent");
    let calls = 0;
    const build = async (buildPath: string): Promise<void> => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      await buildSample(buildPath);
    };
    const [a, b, c] = await Promise.all([
      cachedWorld(name, build),
      cachedWorld(name, build),
      cachedWorld(name, build),
    ]);
    expect(calls).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("builds two names as two worlds", async () => {
    const left = await cachedWorld(uniqueName("left"), buildSample);
    const right = await cachedWorld(uniqueName("right"), buildSample);
    expect(right).not.toBe(left);
    expect(existsSync(join(left, "note.md"))).toBe(true);
    expect(existsSync(join(right, "note.md"))).toBe(true);
  });

  it("hands the build a path that does not exist yet", async () => {
    let existedAtBuild: boolean | undefined;
    await cachedWorld(uniqueName("absent"), async (buildPath) => {
      existedAtBuild = existsSync(buildPath);
      await buildSample(buildPath);
    });
    expect(existedAtBuild).toBe(false);
  });

  it("retries a failed build at the next request, and removes what the failure left", async () => {
    const name = uniqueName("retry");
    let calls = 0;
    let failedPath: string | undefined;
    const build = async (buildPath: string): Promise<void> => {
      calls += 1;
      if (calls === 1) {
        failedPath = buildPath;
        mkdirSync(buildPath);
        writeFileSync(join(buildPath, "half.txt"), "half a world\n");
        throw new Error("the first build fails");
      }
      await buildSample(buildPath);
    };
    await expect(cachedWorld(name, build)).rejects.toThrow("the first build fails");
    expect(failedPath).toBeDefined();
    expect(existsSync(failedPath ?? "")).toBe(false);
    const path = await cachedWorld(name, build);
    expect(calls).toBe(2);
    expect(existsSync(join(path, "note.md"))).toBe(true);
  });

  it("refuses a name that is not a single path segment", () => {
    for (const name of ["", ".", "..", "a/b", "../escape", "a b", ".hidden"]) {
      expect(() => cachedWorld(name, async () => {})).toThrow("not a safe single path segment");
    }
  });

  it("builds with git isolated and puts the caller's git environment back afterwards", async () => {
    // A test's own isolation would be shared by the cache's (nested isolations keep the first
    // one's environment): release it, and set the value the cache must not show to the build.
    restoreGit();
    const saved = process.env["GIT_CONFIG_GLOBAL"];
    const mine = join(tempDir("phax-world-cache-test-env-"), "my-gitconfig");
    writeFileSync(mine, "");
    process.env["GIT_CONFIG_GLOBAL"] = mine;
    let inside: string | undefined;
    let nosystemInside: string | undefined;
    try {
      await cachedWorld(uniqueName("isolated"), async (buildPath) => {
        inside = process.env["GIT_CONFIG_GLOBAL"];
        nosystemInside = process.env["GIT_CONFIG_NOSYSTEM"];
        await buildSample(buildPath);
      });
      expect(inside).toBeDefined();
      expect(inside).not.toBe(mine);
      expect(nosystemInside).toBe("1");
      expect(process.env["GIT_CONFIG_GLOBAL"]).toBe(mine);
    } finally {
      if (saved === undefined) delete process.env["GIT_CONFIG_GLOBAL"];
      else process.env["GIT_CONFIG_GLOBAL"] = saved;
    }
  });
});

describe("copyWorld", () => {
  it("copies the bytes and the modes of the world", async () => {
    const buildPath = await cachedWorld(uniqueName("bytes"), buildSample);
    const copy = join(tempDir("phax-world-cache-test-copy-"), "world");
    copyWorld(buildPath, copy);
    expect(readFileSync(join(copy, "note.md"), "utf8")).toBe("A note.\n");
    expect(readFileSync(join(copy, "state", "run.json"), "utf8")).toBe('{"id":"run-1"}\n');
    expect(modeOf(join(copy, "tool.sh"))).toBe(0o755);
    expect(modeOf(join(copy, "note.md"))).toBe(modeOf(join(buildPath, "note.md")));
    expect(readdirSync(join(copy, "remote.git")).toSorted()).toEqual(
      readdirSync(join(buildPath, "remote.git")).toSorted(),
    );
    expect(git(["rev-parse", "main"], join(copy, "remote.git"))).toBe(
      git(["rev-parse", "main"], join(buildPath, "remote.git")),
    );
  });

  it("makes a separate tree: what is written in a copy stays out of the cache and of other copies", async () => {
    const buildPath = await cachedWorld(uniqueName("separate"), buildSample);
    const parent = tempDir("phax-world-cache-test-copy-");
    const first = join(parent, "first");
    const second = join(parent, "second");
    copyWorld(buildPath, first);
    copyWorld(buildPath, second);

    writeFileSync(join(first, "note.md"), "changed in the first copy\n");
    writeFileSync(join(first, "only-in-first.txt"), "x\n");
    const cachedTip = git(["rev-parse", "main"], join(buildPath, "remote.git"));
    const work = tempDir("phax-world-cache-test-work-");
    git(["clone", "-q", join(first, "remote.git"), work], tmpdir());
    git(["config", "--local", "user.name", "Wanda World"], work);
    git(["config", "--local", "user.email", "wanda@world.test"], work);
    writeFileSync(join(work, "more.txt"), "more\n");
    git(["add", "more.txt"], work);
    git(["commit", "-q", "-m", "more"], work);
    git(["push", "-q", "origin", "main"], work);
    expect(git(["rev-parse", "main"], join(first, "remote.git"))).not.toBe(cachedTip);

    for (const other of [buildPath, second]) {
      expect(readFileSync(join(other, "note.md"), "utf8")).toBe("A note.\n");
      expect(existsSync(join(other, "only-in-first.txt"))).toBe(false);
      expect(git(["rev-parse", "main"], join(other, "remote.git"))).toBe(cachedTip);
    }
  });

  it("never shares an inode with the cache", async () => {
    const buildPath = await cachedWorld(uniqueName("inodes"), buildSample);
    const copy = join(tempDir("phax-world-cache-test-copy-"), "world");
    copyWorld(buildPath, copy);
    for (const file of ["note.md", "tool.sh", join("state", "run.json")]) {
      expect(statSync(join(copy, file)).ino).not.toBe(statSync(join(buildPath, file)).ino);
    }
  });

  it("refuses to copy over what exists", async () => {
    const buildPath = await cachedWorld(uniqueName("exists"), buildSample);
    const copy = join(tempDir("phax-world-cache-test-copy-"), "world");
    copyWorld(buildPath, copy);
    writeFileSync(join(copy, "note.md"), "mine\n");
    expect(() => copyWorld(buildPath, copy)).toThrow();
    expect(readFileSync(join(copy, "note.md"), "utf8")).toBe("mine\n");
  });
});

describe("assertNoBuildPath", () => {
  it("passes on a clean copy", async () => {
    const buildPath = await cachedWorld(uniqueName("clean"), buildSample);
    const copy = join(tempDir("phax-world-cache-test-copy-"), "world");
    copyWorld(buildPath, copy);
    expect(() => assertNoBuildPath(copy, buildPath)).not.toThrow();
  });

  it("refuses a copy with a file holding the build path, naming the copy, the path and the file", async () => {
    const buildPath = await cachedWorld(uniqueName("dirty"), buildSample);
    const copy = join(tempDir("phax-world-cache-test-copy-"), "world");
    copyWorld(buildPath, copy);
    writeFileSync(join(copy, "state", "paths.txt"), `see ${buildPath}/remote.git for the remote\n`);
    expect(() => assertNoBuildPath(copy, buildPath)).toThrow(
      `world copy ${copy} still holds the build path\n  ${buildPath}\n  in ${join("state", "paths.txt")}`,
    );
  });

  it("looks inside .git directories and bare repositories", async () => {
    const buildPath = await cachedWorld(uniqueName("inside-git"), buildSample);
    const copy = join(tempDir("phax-world-cache-test-copy-"), "world");
    copyWorld(buildPath, copy);
    git(
      ["config", "--local", "remote.origin.url", `${buildPath}/remote.git`],
      join(copy, "remote.git"),
    );
    expect(() => assertNoBuildPath(copy, buildPath)).toThrow(`in ${join("remote.git", "config")}`);
  });
});

describe("a test run's cached worlds", () => {
  it("are all gone from the temporary directory once the test file ends", () => {
    const privateTmp = tempDir("phax-world-cache-test-tmp-");
    const reportDir = tempDir("phax-world-cache-test-report-");
    const report = join(reportDir, "build-path.txt");
    const require = createRequire(import.meta.url);
    const vitestEntry = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith("VITEST")) env[key] = value;
    }
    env["TMPDIR"] = privateTmp;
    env["PHAX_WORLD_CACHE_PROBE_REPORT"] = report;

    // 80 000 ms: the probe is a whole vitest run, the old call's own timeout, under the 90 s test timeout.
    const child = boundedSpawn(
      process.execPath,
      [vitestEntry, "run", "--project", "integration", "worldCacheCleanupProbe"],
      { boundMs: 80_000, cwd: REPO_ROOT, env },
    );
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);

    const buildPath = readFileSync(report, "utf8");
    expect(buildPath.startsWith(`${realpathSync(privateTmp)}/`)).toBe(true);
    expect(buildPath).toContain("phax-world-cache-");
    expect(existsSync(buildPath)).toBe(false);
    const left = readdirSync(privateTmp).filter((entry) => entry.startsWith("phax-world-cache-"));
    expect(left).toEqual([]);
  }, 85_000);
});
