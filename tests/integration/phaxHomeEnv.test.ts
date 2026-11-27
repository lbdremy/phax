import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolateGit } from "../helpers/isolateGit.js";
import { isolatePhaxHome, phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  type BoundedExit,
  CLI_BOUND_MS,
  CLI_LAUNCHER,
  GIT_BOUND_MS,
  boundedOutput,
  boundedSpawn,
  cliArgs,
} from "../helpers/boundedSpawn.js";

// PHAX_HOME at the CLI's edge (plan e2e-phax-home, phase-04): every located command but
// `completions` refuses an empty, relative or non-directory PHAX_HOME with exit 2 before it reads
// anything, and says once on stderr which home a set PHAX_HOME moved it to. Each test spawns
// `tsx src/cli/main.ts` in a temporary repository with a temporary HOME and git configuration.

let repo: string;
let home: string;
let restoreHome: () => void;
let restoreGit: () => void;
const extraDirs: string[] = [];

function runCli(args: readonly string[], phaxHome: string | undefined): BoundedExit {
  return boundedSpawn(CLI_LAUNCHER, cliArgs(...args), {
    boundMs: CLI_BOUND_MS,
    cwd: repo,
    env: { ...phaxHomeEnv(), ...(phaxHome === undefined ? {} : { PHAX_HOME: phaxHome }) },
  });
}

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  extraDirs.push(dir);
  return dir;
}

beforeEach(() => {
  restoreGit = isolateGit();
  ({ home, restore: restoreHome } = isolatePhaxHome());
  repo = tempDir("phax-home-env-repo-");
  boundedOutput("git", ["init", "-q"], { cwd: repo, boundMs: GIT_BOUND_MS });
  disableGitAutoMaintenance(repo);
});

afterEach(() => {
  restoreHome();
  restoreGit();
  for (const dir of extraDirs.splice(0)) removeTempDir(dir);
});

describe("an invalid PHAX_HOME", () => {
  it.each([
    ["empty", () => ""],
    ["a tilde path", () => "~/phax-ci"],
    ["a relative path", () => "relative/dir"],
    [
      "an existing regular file",
      () => {
        const file = join(repo, "not-a-dir");
        writeFileSync(file, "x");
        return file;
      },
    ],
  ])("is refused as %s, exit 2, before anything is read or written", (_name, value) => {
    const phaxHome = value();
    const result = runCli(["validate"], phaxHome);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      `PHAX_HOME must be an absolute path to a directory, got "${phaxHome}"`,
    );
    expect(readdirSync(join(home, ".phax"))).toEqual([]);
    expect(existsSync(join(repo, "relative"))).toBe(false);
    expect(existsSync(join(repo, "~"))).toBe(false);
  });

  it("is one refused line under --json, naming PHAX_HOME", () => {
    const result = runCli(["validate", "--json"], "relative/dir");
    expect(result.status).toBe(2);
    const lines = result.stderr
      .split("\n")
      .filter((each) => each !== "")
      .map((each): unknown => JSON.parse(each));
    expect(lines).toEqual([
      {
        kind: "refused",
        source: "command",
        path: ["validate"],
        expected: "PHAX_HOME: an absolute path to a directory",
        text: 'PHAX_HOME must be an absolute path to a directory, got "relative/dir"',
        exit: 2,
      },
    ]);
  });

  it.each([[["--help"]], [["--version"]], [["--usage"]], [["completions", "zsh"]]])(
    "neither refuses nor announces %j",
    (args) => {
      const result = runCli(args, "relative/dir");
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain("PHAX_HOME");
      expect(result.stderr).not.toContain("phax home:");
    },
  );
});

describe("the moved home's notice", () => {
  it("is exactly one stderr line naming the home, and nothing on stdout", () => {
    const phaxHome = tempDir("phax-home-env-home-");
    const result = runCli(["ls"], phaxHome);
    const notice = `phax home: ${phaxHome} (PHAX_HOME)`;
    expect(result.stderr.split("\n").filter((each) => each.startsWith("phax home:"))).toEqual([
      notice,
    ]);
    expect(result.stdout).not.toContain("phax home:");
  });

  it("is a note line under --json", () => {
    const phaxHome = tempDir("phax-home-env-home-");
    const result = runCli(["ls", "--json"], phaxHome);
    const notes = result.stderr
      .split("\n")
      .filter((each) => each !== "")
      .map((each): unknown => JSON.parse(each))
      .filter((each) => JSON.stringify(each).includes("phax home:"));
    expect(notes).toEqual([{ kind: "note", text: `phax home: ${phaxHome} (PHAX_HOME)` }]);
    expect(result.stdout).not.toContain("phax home:");
  });

  it("is not written when PHAX_HOME is unset", () => {
    const result = runCli(["ls"], undefined);
    expect(result.stderr).not.toContain("phax home:");
    expect(result.stdout).not.toContain("phax home:");
  });
});
