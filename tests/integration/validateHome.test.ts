import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolateGit } from "../helpers/isolateGit.js";
import { isolatePhaxHome, phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  CLI_BOUND_MS,
  CLI_LAUNCHER,
  GIT_BOUND_MS,
  boundedOutput,
  boundedSpawn,
  cliArgs,
} from "../helpers/boundedSpawn.js";

// `phax validate` names the phax home it uses and whether PHAX_HOME or the default chose it
// (plan e2e-phax-home, phase-05). Each test spawns `tsx src/cli/main.ts` in a temporary
// repository with a temporary HOME and git configuration.

const CONFIG = {
  version: 1,
  name: "validate-home",
  gateProfiles: { standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
};

let repo: string;
let home: string;
let restoreHome: () => void;
let restoreGit: () => void;
let savedPhaxHome: string | undefined;
const extraDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  extraDirs.push(dir);
  return dir;
}

/** Every entry directly under `dir`, with the sha256 of its content. */
function hashedListing(dir: string): ReadonlyArray<readonly [string, string]> {
  return readdirSync(dir)
    .toSorted()
    .map(
      (name) =>
        [
          name,
          createHash("sha256")
            .update(readFileSync(join(dir, name)))
            .digest("hex"),
        ] as const,
    );
}

beforeEach(() => {
  savedPhaxHome = process.env["PHAX_HOME"];
  restoreGit = isolateGit();
  ({ home, restore: restoreHome } = isolatePhaxHome());
  repo = tempDir("phax-validate-home-repo-");
  boundedOutput("git", ["init", "-q"], { cwd: repo, boundMs: GIT_BOUND_MS });
  disableGitAutoMaintenance(repo);
  writeFileSync(join(repo, "phax.json"), JSON.stringify(CONFIG, null, 2));
});

afterEach(() => {
  if (savedPhaxHome === undefined) delete process.env["PHAX_HOME"];
  else process.env["PHAX_HOME"] = savedPhaxHome;
  restoreHome();
  restoreGit();
  for (const dir of extraDirs.splice(0)) removeTempDir(dir);
});

describe("phax validate names the phax home", () => {
  it("marks a home PHAX_HOME chose, in text and JSON (ac-validate-home)", () => {
    const phaxHome = tempDir("phax-validate-home-moved-");
    writeFileSync(join(phaxHome, "config.json"), "{}\n");

    const text = boundedSpawn(CLI_LAUNCHER, cliArgs("validate"), {
      boundMs: CLI_BOUND_MS,
      cwd: repo,
      env: { ...phaxHomeEnv(), PHAX_HOME: phaxHome },
    });
    expect(text.status).toBe(0);
    const lines = text.stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("✓ config is valid (project: validate-home)");
    expect(lines[1]).toBe(`  home:    ${phaxHome} (PHAX_HOME)`);
    expect(lines).toContain(`  global:  ${join(phaxHome, "config.json")}`);

    const json = boundedSpawn(CLI_LAUNCHER, cliArgs("validate", "--json"), {
      boundMs: CLI_BOUND_MS,
      cwd: repo,
      env: { ...phaxHomeEnv(), PHAX_HOME: phaxHome },
    });
    expect(json.status).toBe(0);
    const answer: unknown = JSON.parse(json.stdout);
    expect(answer).toHaveProperty("home", { path: phaxHome, from: "PHAX_HOME" });
  });

  it("marks the default home when PHAX_HOME is unset (ac-default-unchanged)", () => {
    const result = boundedSpawn(CLI_LAUNCHER, cliArgs("validate"), {
      boundMs: CLI_BOUND_MS,
      cwd: repo,
      env: phaxHomeEnv(),
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines[1]).toBe(`  home:    ${join(home, ".phax")} (default)`);
  });

  it("never hands a PHAX_HOME the test process exports to a child (ac-leak)", () => {
    const sentinel = tempDir("phax-validate-home-sentinel-");
    writeFileSync(join(sentinel, "config.json"), JSON.stringify({ sentinel: true }) + "\n");
    const before = hashedListing(sentinel);
    process.env["PHAX_HOME"] = sentinel;

    const result = boundedSpawn(CLI_LAUNCHER, cliArgs("validate", "--json"), {
      boundMs: CLI_BOUND_MS,
      cwd: repo,
      env: phaxHomeEnv(),
    });

    expect(result.status).toBe(0);
    const answer: unknown = JSON.parse(result.stdout);
    expect(answer).toHaveProperty("home", { path: join(home, ".phax"), from: "default" });
    expect(hashedListing(sentinel)).toEqual(before);
  });
});
