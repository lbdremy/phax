import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { OutputPort } from "../../../src/ports/output.js";
import { runSchemaUpgrade } from "../../../src/cli/commands/schema.js";

function makeFakeOut() {
  const lines: string[] = [];
  const errors: string[] = [];
  const out: OutputPort = {
    log: (msg: string) => lines.push(msg),
    warn: (msg: string) => lines.push(msg),
    error: (msg: string) => errors.push(msg),
  };
  return { out, lines, errors };
}

describe("runSchemaUpgrade", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phax-schema-upgrade-cli-"));
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 1 and prints an error when no phax.json exists", () => {
    const { out, errors } = makeFakeOut();
    const code = runSchemaUpgrade(out);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("phax init"))).toBe(true);
  });

  it("returns 0 and prints Updated when schema is written for the first time", () => {
    writeFileSync(join(tmpDir, "phax.json"), JSON.stringify({ version: 1 }));
    const { out, lines } = makeFakeOut();
    const code = runSchemaUpgrade(out);
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith("Updated "))).toBe(true);
  });

  it("returns 0 and prints already up to date on second call", () => {
    writeFileSync(join(tmpDir, "phax.json"), JSON.stringify({ version: 1 }));
    runSchemaUpgrade(makeFakeOut().out);
    const { out, lines } = makeFakeOut();
    const code = runSchemaUpgrade(out);
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("already up to date"))).toBe(true);
  });
});
