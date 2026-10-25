import fs, { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_ROUTING_PATH } from "../../src/app/loadRouting.js";
import { PHAX_HOME_DIR, TELEMETRY_CONFIG_PATH } from "../../src/app/loadTelemetryConfig.js";
import {
  assertNoGuardViolations,
  installPhaxHomeGuard,
  isInsidePhaxHome,
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

function inside(path: string, home: string): boolean {
  const rel = relative(home, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

describe("isInsidePhaxHome", () => {
  const root = "/home/dev/.phax";
  const repo = "/home/dev/.phax/worktrees/phax.x/phase-01";

  it.each([
    ["the root itself", root, [], true],
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
    expect(isInsidePhaxHome(path, root, exempt)).toBe(expected);
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
    expect(takeGuardViolations()).toEqual([{ call: "fs.readFileSync", path: PROBE }]);
  });

  it("rejects a promise call instead of throwing", async () => {
    let call: Promise<unknown> | undefined;
    expect(() => {
      call = readFile(PROBE);
    }).not.toThrow();
    await expect(call).rejects.toMatchObject({ code: "EACCES", path: PROBE });
    expect(takeGuardViolations()).toEqual([{ call: "fs.promises.readFile", path: PROBE }]);
  });

  it("calls a callback call back with the error", async () => {
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      fs.readFile(PROBE, (err) => resolve(err));
    });
    expect(error).toMatchObject({ code: "EACCES", path: PROBE });
    expect(takeGuardViolations()).toEqual([{ call: "fs.readFile", path: PROBE }]);
  });

  it("returns a stream that emits the error", async () => {
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      fs.createReadStream(PROBE).on("error", resolve);
    });
    expect(error).toMatchObject({ code: "EACCES", path: PROBE });
    expect(takeGuardViolations()).toEqual([{ call: "fs.createReadStream", path: PROBE }]);
  });

  it("checks both paths of a two-path call", () => {
    const outside = join(tmpdir(), "phax-guard-never-created");
    expect(() => fs.renameSync(outside, PROBE)).toThrow(/EACCES/);
    expect(takeGuardViolations()).toEqual([{ call: "fs.renameSync", path: PROBE }]);
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

// Spawned children are out of the guard's reach: a suite that runs the phax CLI
// gives the child a temporary HOME, or is listed here with the reason.
describe("suites that spawn the phax CLI", () => {
  const TESTS_DIR = join(process.cwd(), "tests");
  const SELF = "unit/phaxHomeGuard.test.ts";
  const EXEMPT: Readonly<Record<string, string>> = {
    "integration/heldStopCommands.test.ts":
      "its child runs with childEnvUnder(home), a temporary HOME",
    "integration/stoppedRunCommands.test.ts":
      "its child runs with HOME set to the world's temporary home",
    "integration/phaseGuard.test.ts": "its child runs with HOME set to a temporary home",
    "integration/plansEstimateCommand.test.ts": "its child runs with HOME set to a temporary home",
    "integration/authorArtifact.test.ts":
      "names src/cli/main.ts only as a planned file in a fixture; spawns nothing",
  };
  const NEEDLES = ["src/cli/main.ts", "dist/cli/main.js"];
  const REMEDIES = ["phaxHomeEnv", "isolatePhaxHome"];

  const naming = [...suites(join(TESTS_DIR, "unit")), ...suites(join(TESTS_DIR, "integration"))]
    .map((file) => ({ rel: relative(TESTS_DIR, file), text: readFileSync(file, "utf8") }))
    .filter(({ rel }) => rel !== SELF)
    .filter(({ text }) => NEEDLES.some((needle) => text.includes(needle)));

  it("finds the suites that name the CLI entry point", () => {
    expect(naming.length).toBeGreaterThan(5);
  });

  it("gives every one a temporary HOME for its child, or lists it with a reason", () => {
    const unguarded = naming
      .filter(({ text }) => !REMEDIES.some((remedy) => text.includes(remedy)))
      .map(({ rel }) => rel)
      .filter((rel) => !(rel in EXEMPT));
    expect(
      unguarded,
      "pass phaxHomeEnv() as the child's env, or list the suite with a reason",
    ).toEqual([]);
  });

  it("lists only suites that still name the CLI entry point and do not use the helper", () => {
    const names = new Map(naming.map(({ rel, text }) => [rel, text]));
    const stale = Object.keys(EXEMPT).filter((rel) => {
      const text = names.get(rel);
      return text === undefined || REMEDIES.some((remedy) => text.includes(remedy));
    });
    expect(stale).toEqual([]);
  });
});
