import { describe, expect, it } from "vitest";
import { spawnSync, spawnSyncReturns } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const mainTs = join(repoRoot, "src/cli/main.ts");

function runCli(args: string[]): spawnSyncReturns<string> {
  return spawnSync("tsx", [mainTs, ...args], {
    encoding: "utf8",
  });
}

describe("CLI error messages", () => {
  it("unknown command: non-zero exit, suggestion, help pointer, no stack trace", () => {
    const result = runCli(["resum"]);
    expect(result.status).not.toBe(0);
    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    expect(combined).toMatch(/unknown command/i);
    expect(combined).toMatch(/Did you mean/i);
    expect(combined).toContain("resume");
    expect(combined).toMatch(/--help/);
    expect(combined).not.toMatch(/Error:\s+Error:/);
    expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
  });

  it("unknown flag on a subcommand: non-zero exit, readable message, no stack trace", () => {
    const result = runCli(["ls", "--notaflag"]);
    expect(result.status).not.toBe(0);
    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    expect(combined).toMatch(/unknown option/i);
    expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
  });

  it("invalid choice for completions <shell>: lists valid choices, no stack trace", () => {
    const result = runCli(["completions", "ksh"]);
    expect(result.status).not.toBe(0);
    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    expect(combined).toContain("ksh");
    expect(combined).toContain("zsh");
    expect(combined).toContain("bash");
    expect(combined).not.toMatch(/at\s+\S+:\d+:\d+/);
  });

  it("valid command still exits 0", () => {
    const result = runCli(["--version"]);
    expect(result.status).toBe(0);
  });
});
