import { describe, expect, it } from "vitest";
import { spawnSync, spawnSyncReturns } from "node:child_process";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const mainTs = join(repoRoot, "src/cli/main.ts");

function runCli(args: string[], env?: NodeJS.ProcessEnv): spawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function isUsageAvailable(): boolean {
  const check = spawnSync("usage", ["--version"], { encoding: "utf8" });
  return check.error === undefined && check.status === 0;
}

function pathWithoutUsage(): string {
  // Locate `usage` by searching PATH directories, then exclude that directory.
  // Uses only Node.js fs — no shell `which` invocation.
  const pathDirs = (process.env.PATH ?? "").split(":");
  const usageDir = pathDirs.find((dir) => existsSync(join(dir, "usage")));
  if (usageDir === undefined) {
    return process.env.PATH ?? "/usr/bin:/bin";
  }
  return pathDirs.filter((p) => p !== usageDir).join(":");
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
