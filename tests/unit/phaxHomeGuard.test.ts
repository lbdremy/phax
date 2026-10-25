import fs, { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { glob as globPromise, readFile, watch as watchPromise } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_ROUTING_PATH } from "../../src/app/loadRouting.js";
import { PHAX_HOME_DIR, TELEMETRY_CONFIG_PATH } from "../../src/app/loadTelemetryConfig.js";
import {
  assertNoGuardViolations,
  installPhaxHomeGuard,
  isInsidePhaxHome,
  markCollecting,
  takeGuardViolations,
} from "../setup/phaxHomeGuard.js";
import { isolatePhaxHome } from "../helpers/isolatePhaxHome.js";
import { removeTempDir } from "../helpers/tempGit.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// The mocked homedir() answers the import-time home until a test isolates one.
const IMPORT_TIME_HOME = homedir();
const REAL_HOME = userInfo().homedir;
const PROBE = join(REAL_HOME, ".phax", "guard-probe-does-not-exist");

async function firstOf(iterable: AsyncIterable<unknown>): Promise<unknown> {
  for await (const entry of iterable) return entry;
  return undefined;
}

function inside(path: string, home: string): boolean {
  const rel = relative(home, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

describe("isInsidePhaxHome", () => {
  const root = "/home/dev/.phax";
  const repo = "/home/dev/.phax/worktrees/phax.x/phase-01";

  it.each([
    ["the root itself", root, [], true],
    ["the root, case-folded", "/home/dev/.PHAX/config.json", [], true],
    [
      "the exempted repository, case-folded",
      "/home/dev/.phax/Worktrees/phax.x/PHASE-01/a",
      [repo],
      false,
    ],
    ["the sibling ~/.phaxx, case-folded", "/home/dev/.PHAXX/config.json", [], false],
  ])("%s with foldCase", (_name, path, exempt, expected) => {
    expect(isInsidePhaxHome(path, [root], exempt, true)).toBe(expected);
  });

  it("compares exactly without foldCase", () => {
    expect(isInsidePhaxHome("/home/dev/.PHAX/config.json", [root], [], false)).toBe(false);
  });

  it("guards every root: ~/.phax and its realpath", () => {
    const roots = [root, "/data/dev-phax"];
    expect(isInsidePhaxHome("/data/dev-phax/runs/a.json", roots, [], false)).toBe(true);
    expect(isInsidePhaxHome("/data/dev-phaxx/a.json", roots, [], false)).toBe(false);
  });

  it.each([
    ["a file below the root", `${root}/config.json`, [], true],
    ["a deep path below the root", `${root}/runs/a/b/c.json`, [], true],
    ["the sibling ~/.phaxx", "/home/dev/.phaxx/config.json", [], false],
    ["the sibling ~/.phax-backup", "/home/dev/.phax-backup", [], false],
    ["the parent of the root", "/home/dev", [], false],
    ["a path elsewhere", "/tmp/phax/config.json", [], false],
    ["the exempted repository itself", repo, [repo], false],
    ["a path inside the exempted repository", `${repo}/src/cli/main.ts`, [repo], false],
    ["the config beside an exempted worktree", `${root}/config.json`, [repo], true],
    ["a sibling worktree of the exempted one", `${root}/worktrees/phax.x/phase-02/a`, [repo], true],
    ["a sibling directory sharing the repository's prefix", `${repo}-2/a`, [repo], true],
  ])("%s", (_name, path, exempt, expected) => {
    expect(isInsidePhaxHome(path, [root], exempt, false)).toBe(expected);
  });
});

describe("the guard on the real ~/.phax", () => {
  it("throws EACCES for a sync call, never reads the disk, and records it", () => {
    let thrown: unknown;
    try {
      readFileSync(PROBE);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "EACCES", path: PROBE });
    expect(String((thrown as Error).message)).toContain("tests/helpers/isolatePhaxHome.ts");
    expect(takeGuardViolations()).toEqual([
      { call: "fs.readFileSync", path: PROBE, during: "test" },
    ]);
  });

  it("rejects a promise call instead of throwing", async () => {
    let call: Promise<unknown> | undefined;
    expect(() => {
      call = readFile(PROBE);
    }).not.toThrow();
    await expect(call).rejects.toMatchObject({ code: "EACCES", path: PROBE });
    expect(takeGuardViolations()).toEqual([
      { call: "fs.promises.readFile", path: PROBE, during: "test" },
    ]);
  });

  it("calls a callback call back with the error", async () => {
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      fs.readFile(PROBE, (err) => resolve(err));
    });
    expect(error).toMatchObject({ code: "EACCES", path: PROBE });
    expect(takeGuardViolations()).toEqual([{ call: "fs.readFile", path: PROBE, during: "test" }]);
  });

  it("returns a stream that emits the error", async () => {
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      fs.createReadStream(PROBE).on("error", resolve);
    });
    expect(error).toMatchObject({ code: "EACCES", path: PROBE });
    expect(takeGuardViolations()).toEqual([
      { call: "fs.createReadStream", path: PROBE, during: "test" },
    ]);
  });

  it("checks both paths of a two-path call", () => {
    const outside = join(tmpdir(), "phax-guard-never-created");
    expect(() => fs.renameSync(outside, PROBE)).toThrow(/EACCES/);
    expect(takeGuardViolations()).toEqual([{ call: "fs.renameSync", path: PROBE, during: "test" }]);
  });

  it("refuses a relative path that resolves into ~/.phax", () => {
    const cwd = process.cwd();
    try {
      process.chdir(join(REAL_HOME, ".phax"));
    } catch {
      return; // no real ~/.phax on this machine: nothing to resolve against
    }
    try {
      expect(() => readFileSync("guard-probe-does-not-exist")).toThrow(/EACCES/);
    } finally {
      process.chdir(cwd);
    }
    expect(takeGuardViolations()).toHaveLength(1);
  });

  it("fails the test for a refusal the code under test swallowed, naming call, path and helper", () => {
    try {
      readFileSync(PROBE);
    } catch {
      // swallowed, as loadConfig's overlay reader does
    }
    let message = "";
    try {
      assertNoGuardViolations();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(`fs.readFileSync ${PROBE}`);
    expect(message).toContain("tests/helpers/isolatePhaxHome.ts");
    expect(takeGuardViolations()).toEqual([]);
  });

  it("labels a refusal recorded while the file is collected", () => {
    markCollecting(true);
    try {
      readFileSync(PROBE);
    } catch {
      // swallowed
    } finally {
      markCollecting(false);
    }
    let message = "";
    try {
      assertNoGuardViolations();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(`fs.readFileSync ${PROBE} (during collection)`);
  });

  it.runIf(process.platform === "darwin")(
    "refuses a case variant of the path on darwin's case-insensitive volumes",
    () => {
      const variant = join(REAL_HOME, ".PHAX", "guard-probe-does-not-exist");
      expect(() => readFileSync(variant)).toThrow(/EACCES/);
      expect(takeGuardViolations()).toEqual([
        { call: "fs.readFileSync", path: variant, during: "test" },
      ]);
    },
  );

  it.each([
    ["fs.statfsSync", () => fs.statfsSync(PROBE)],
    ["fs.chownSync", () => fs.chownSync(PROBE, 0, 0)],
    ["fs.lchownSync", () => fs.lchownSync(PROBE, 0, 0)],
    ["fs.lutimesSync", () => fs.lutimesSync(PROBE, 0, 0)],
    ["fs.watch", () => fs.watch(PROBE)],
    ["fs.globSync", () => fs.globSync(`${PROBE}/*.json`)],
  ])("throws EACCES for %s", (call, run) => {
    expect(run).toThrow(/EACCES/);
    expect(takeGuardViolations().map((v) => v.call)).toEqual([call]);
  });

  it("refuses a glob whose cwd is inside ~/.phax, and a relative pattern under it", () => {
    expect(() => fs.globSync("*.json", { cwd: PROBE })).toThrow(/EACCES/);
    expect(takeGuardViolations()).toEqual([
      { call: "fs.globSync", path: join(PROBE, "*.json"), during: "test" },
    ]);
  });

  it.each([
    ["fs.promises.statfs", () => fs.promises.statfs(PROBE)],
    ["fs.promises.chown", () => fs.promises.chown(PROBE, 0, 0)],
    ["fs.promises.lutimes", () => fs.promises.lutimes(PROBE, 0, 0)],
    ["fs.openAsBlob", () => fs.openAsBlob(PROBE)],
  ])("rejects %s", async (call, run) => {
    await expect(run()).rejects.toMatchObject({ code: "EACCES", path: PROBE });
    expect(takeGuardViolations().map((v) => v.call)).toEqual([call]);
  });

  it("calls fs.glob and fs.statfs back with the error", async () => {
    const globError = await new Promise<unknown>((resolve) => {
      fs.glob(`${PROBE}/*`, (err) => resolve(err));
    });
    const statfsError = await new Promise<unknown>((resolve) => {
      fs.statfs(PROBE, (err) => resolve(err));
    });
    expect(globError).toMatchObject({ code: "EACCES" });
    expect(statfsError).toMatchObject({ code: "EACCES", path: PROBE });
    expect(takeGuardViolations().map((v) => v.call)).toEqual(["fs.glob", "fs.statfs"]);
  });

  it("fails the iteration of fs.promises.glob and fs.promises.watch", async () => {
    await expect(firstOf(globPromise(`${PROBE}/*`))).rejects.toMatchObject({ code: "EACCES" });
    await expect(firstOf(watchPromise(PROBE))).rejects.toMatchObject({ code: "EACCES" });
    expect(takeGuardViolations().map((v) => v.call)).toEqual([
      "fs.promises.glob",
      "fs.promises.watch",
    ]);
  });

  it("records fs.watchFile and returns a watcher that never fires", () => {
    const listener = vi.fn();
    const watcher = fs.watchFile(PROBE, listener);
    expect(watcher.unref()).toBe(watcher);
    fs.unwatchFile(PROBE, listener);
    expect(listener).not.toHaveBeenCalled();
    expect(takeGuardViolations()).toEqual([{ call: "fs.watchFile", path: PROBE, during: "test" }]);
  });

  it("passes a call outside ~/.phax through unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phax-guard-outside-"));
    try {
      const file = join(dir, "probe.txt");
      writeFileSync(file, "outside");
      expect(readFileSync(file, "utf8")).toBe("outside");
      expect(await readFile(file, "utf8")).toBe("outside");
      expect(readdirSync(dir)).toEqual(["probe.txt"]);
      expect(takeGuardViolations()).toEqual([]);
    } finally {
      removeTempDir(dir);
    }
  });

  it("passes the repository under test through, even from inside ~/.phax", () => {
    const repoFile = join(process.cwd(), "package.json");
    expect(readFileSync(repoFile, "utf8")).toContain('"name"');
    expect(takeGuardViolations()).toEqual([]);
  });

  it("wraps once however many times it is installed", () => {
    const before = fs.readFileSync;
    installPhaxHomeGuard();
    installPhaxHomeGuard();
    expect(fs.readFileSync).toBe(before);
    expect(() => readFileSync(PROBE)).toThrow(/EACCES/);
    expect(takeGuardViolations()).toHaveLength(1);
  });
});

describe("isolatePhaxHome", () => {
  let isolation: ReturnType<typeof isolatePhaxHome>;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env["HOME"];
    isolation = isolatePhaxHome();
  });

  afterEach(() => {
    isolation.restore();
    expect(process.env["HOME"]).toBe(savedHome);
  });

  it("moves homedir() and HOME into the per-test home, which has an empty .phax", () => {
    expect(homedir()).toBe(isolation.home);
    expect(process.env["HOME"]).toBe(isolation.home);
    expect(inside(isolation.home, REAL_HOME)).toBe(false);
    expect(readdirSync(join(isolation.home, ".phax"))).toEqual([]);
  });

  it("keeps the import-time constants in the import-time home, outside the real one", () => {
    for (const constant of [PHAX_HOME_DIR, TELEMETRY_CONFIG_PATH, MODEL_ROUTING_PATH]) {
      expect(inside(constant, IMPORT_TIME_HOME)).toBe(true);
      expect(inside(constant, REAL_HOME)).toBe(false);
    }
    expect(IMPORT_TIME_HOME).not.toBe(isolation.home);
  });

  it("puts the per-test home in a spawned child's environment", async () => {
    const { phaxHomeEnv } = await import("../helpers/isolatePhaxHome.js");
    expect(phaxHomeEnv()["HOME"]).toBe(isolation.home);
  });
});

function suites(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .map((file) => join(dir, file));
}

// Spawned children are out of the guard's reach: every call that spawns the
// phax CLI must give the child a temporary HOME in its `env`.
//
// The check reads source text, so it is a tripwire, not a proof. It finds a
// spawn-family call (spawn, spawnSync, exec, execSync, execFile, execFileSync,
// fork) whose arguments name the entry point, literally or through a `const`
// assigned from it, and requires an `env:` option whose expression calls
// phaxHomeEnv() or childEnvUnder() or sets HOME. It cannot tell that the HOME
// is a temporary one, nor see a spawn whose entry point reaches it through a
// helper in another file.
const NEEDLES = ["src/cli/main.ts", "dist/cli/main.js"];
const SPAWN_CALL = /\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec|fork)\(/g;
const TEMP_HOME_ENV = /phaxHomeEnv\(|childEnvUnder\(|\bHOME:/;

// The index just past the expression that starts at `from`, stopping at the
// first `stop` character outside brackets and strings (or the closing bracket
// of the enclosing call).
function scanExpression(text: string, from: number, stop: string): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if ("([{".includes(c)) {
      depth++;
    } else if (")]}".includes(c)) {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && stop.includes(c)) {
      return i;
    }
  }
  return text.length;
}

/** A suite's CLI spawns, by line, and whether each gives the child a temporary HOME. */
function cliSpawns(text: string): { readonly line: number; readonly tempHome: boolean }[] {
  const entryNames = [...text.matchAll(/\bconst\s+(\w+)\s*=([^;]*);/g)]
    .filter((m) => NEEDLES.some((needle) => (m[2] ?? "").includes(needle)))
    .map((m) => m[1] ?? "");
  const namesEntry = (args: string) =>
    NEEDLES.some((needle) => args.includes(needle)) ||
    entryNames.some((name) => new RegExp(`\\b${name}\\b`).test(args));
  const spawns: { line: number; tempHome: boolean }[] = [];
  for (const match of text.matchAll(SPAWN_CALL)) {
    const open = (match.index ?? 0) + match[0].length;
    const args = text.slice(open, scanExpression(text, open, ""));
    if (!namesEntry(args)) continue;
    const env = /\benv:/.exec(args);
    const envExpression =
      env === null ? "" : args.slice(env.index, scanExpression(args, env.index + 4, ","));
    spawns.push({
      line: text.slice(0, match.index).split("\n").length,
      tempHome: TEMP_HOME_ENV.test(envExpression),
    });
  }
  return spawns;
}

function unguardedCliSpawns(text: string): number[] {
  return cliSpawns(text)
    .filter((spawn) => !spawn.tempHome)
    .map((spawn) => spawn.line);
}

describe("suites that spawn the phax CLI", () => {
  const TESTS_DIR = join(process.cwd(), "tests");
  const SELF = "unit/phaxHomeGuard.test.ts";

  const naming = [...suites(join(TESTS_DIR, "unit")), ...suites(join(TESTS_DIR, "integration"))]
    .map((file) => ({ rel: relative(TESTS_DIR, file), text: readFileSync(file, "utf8") }))
    .filter(({ rel }) => rel !== SELF)
    .filter(({ text }) => NEEDLES.some((needle) => text.includes(needle)));

  it("finds the suites that name the CLI entry point", () => {
    expect(naming.length).toBeGreaterThan(5);
  });

  it("flags a CLI spawn without a temporary HOME, by name or literal, and passes one with it", () => {
    const entry = 'const mainTs = join(root, "src/cli/main.ts");\n';
    expect(unguardedCliSpawns(`${entry}spawnSync("tsx", [mainTs], { encoding: "utf8" });`)).toEqual(
      [2],
    );
    expect(
      unguardedCliSpawns("execSync(`tsx src/cli/main.ts ls`, { env: { ...process.env } });"),
    ).toEqual([1]);
    expect(
      unguardedCliSpawns(
        `${entry}spawnSync("tsx", [mainTs], { env: { ...process.env, HOME: h } });`,
      ),
    ).toEqual([]);
    expect(
      unguardedCliSpawns(`${entry}spawnSync("tsx", [mainTs], { env: phaxHomeEnv() });`),
    ).toEqual([]);
    expect(unguardedCliSpawns(`${entry}execFileSync("git", ["status"], { cwd: root });`)).toEqual(
      [],
    );
  });

  it("gives every CLI child a temporary HOME in its env", () => {
    expect(naming.flatMap(({ text }) => cliSpawns(text)).length).toBeGreaterThan(5);
    const unguarded = naming.flatMap(({ rel, text }) =>
      unguardedCliSpawns(text).map((line) => `${rel}:${line}`),
    );
    expect(unguarded, "pass phaxHomeEnv() as the child's env").toEqual([]);
  });
});
