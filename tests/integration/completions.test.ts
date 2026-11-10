import { describe, expect, it } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const mainTs = join(repoRoot, "src/cli/main.ts");

function runCli(args: string[], env?: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], {
    encoding: "utf8",
    env: { ...phaxHomeEnv(), ...env },
  });
}

function isUsageAvailable(): boolean {
  const check = spawnSync("usage", ["--version"], { encoding: "utf8" });
  return check.error === undefined && check.status === 0;
}

function pathWithoutUsage(): string {
  // Only what the spawn needs: the repo's bins (tsx), node's own directory and
  // the system tools tsx's shim calls. Probing every PATH directory would reach
  // the ancestors' node_modules/.bin pnpm adds, which lie inside ~/.phax when
  // the suite runs in a phax worktree.
  const dirs = [
    join(repoRoot, "node_modules", ".bin"),
    dirname(process.execPath),
    "/usr/bin",
    "/bin",
  ];
  for (const dir of dirs) {
    if (existsSync(join(dir, "usage"))) throw new Error(`usage is installed in ${dir}`);
  }
  return dirs.join(":");
}

describe("phax completions", () => {
  it("rejects an invalid shell with actionable error listing valid choices", () => {
    const result = runCli(["completions", "ksh"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid shell");
    expect(result.stderr).toContain("ksh");
    expect(result.stderr).toContain("zsh");
    expect(result.stderr).toContain("bash");
    expect(result.stderr).toContain("fish");
  });

  it("rejects an empty shell argument", () => {
    const result = runCli(["completions", ""]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid shell");
  });

  it("produces a non-empty completion script for zsh when usage is available", () => {
    if (!isUsageAvailable()) return;
    const result = runCli(["completions", "zsh"]);
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    // Contract: zsh completions must start with a #compdef or _phax marker.
    expect(result.stdout).toMatch(/#compdef phax|_phax/);
  });

  it("produces a non-empty completion script for bash when usage is available", () => {
    if (!isUsageAvailable()) return;
    const result = runCli(["completions", "bash"]);
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("produces a non-empty completion script for fish when usage is available", () => {
    if (!isUsageAvailable()) return;
    const result = runCli(["completions", "fish"]);
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("fails with actionable error when usage CLI is not on PATH", () => {
    if (!isUsageAvailable()) return;
    const filteredPath = pathWithoutUsage();
    const result = runCli(["completions", "zsh"], { PATH: filteredPath });
    expect(result.status).not.toBe(0);
    expect(result.stderr ?? "").toContain("`usage` CLI");
    expect(result.stderr ?? "").toContain("brew install");
  });
});
