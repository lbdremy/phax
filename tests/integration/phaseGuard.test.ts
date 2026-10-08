import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// A made-up repository with two linked worktrees: one holding `.phax-context/`
// (a phase worktree) and one without. The CLI runs from source with HOME at a
// temp dir, so no real ~/.phax is read or written.

const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

let base: string;
let mainRoot: string;
let phaseWorktree: string;
let plainWorktree: string;
let home: string;

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, stdio: "ignore" });
}

function runCli(cwd: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

const guardMessage = (command: string): string =>
  `✗ phax ${command} is not available inside a phase worktree; phax brief is`;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-phase-guard-")));
  mainRoot = join(base, "repo");
  phaseWorktree = join(base, "phase-01");
  plainWorktree = join(base, "plain");
  home = join(base, "home");
  mkdirSync(mainRoot);
  mkdirSync(home);
  git(mainRoot, "init -q -b main");
  disableGitAutoMaintenance(mainRoot);
  writeFileSync(
    join(mainRoot, "phax.json"),
    JSON.stringify({
      version: 1,
      name: "made-up",
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  git(mainRoot, "add phax.json");
  git(
    mainRoot,
    "-c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false commit -q -m init",
  );
  git(mainRoot, `worktree add -q -b phase-01 ${phaseWorktree}`);
  git(mainRoot, `worktree add -q -b plain ${plainWorktree}`);
  mkdirSync(join(phaseWorktree, ".phax-context"));
});

afterAll(() => {
  removeTempDir(base);
});

describe("phase guard — inside a phase worktree", () => {
  it("refuses phax archive with the guard's message and exit 1", () => {
    const result = runCli(phaseWorktree, ["archive", "x"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(guardMessage("archive"));
  });

  it("refuses phax run with the guard's message and exit 1", () => {
    const result = runCli(phaseWorktree, ["run", "--plan", "p"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(guardMessage("run"));
  });

  it("refuses from a subdirectory of the phase worktree too", () => {
    const sub = join(phaseWorktree, "src");
    mkdirSync(sub, { recursive: true });
    const result = runCli(sub, ["archive", "x"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(guardMessage("archive"));
  });

  it("lets --version through", () => {
    const result = runCli(phaseWorktree, ["--version"]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("not available inside a phase worktree");
  });

  it("lets phax schema upgrade reach its own code", () => {
    const result = runCli(phaseWorktree, ["schema", "upgrade"]);
    expect(result.stderr).not.toContain("not available inside a phase worktree");
  });

  it("lets phax brief reach its own refusal when no provider is configured", () => {
    const result = runCli(phaseWorktree, ["brief", "src/x.ts"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No brief provider is configured");
    expect(result.stderr).not.toContain("not available inside a phase worktree");
  });
});

describe("phase guard — outside a phase worktree", () => {
  it("does not refuse phax archive from the main checkout", () => {
    const result = runCli(mainRoot, ["archive", "x"]);
    expect(result.stderr).not.toContain("not available inside a phase worktree");
  });

  it("does not refuse phax archive from a linked worktree without .phax-context/", () => {
    const result = runCli(plainWorktree, ["archive", "x"]);
    expect(result.stderr).not.toContain("not available inside a phase worktree");
  });
});
