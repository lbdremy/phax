import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutputPort } from "../../../src/ports/output.js";
import { runInit } from "../../../src/cli/commands/init.js";

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

describe("runInit", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "phax-init-cli-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 and prints created lines in an empty dir", async () => {
    const { out, lines } = makeFakeOut();
    const code = await runInit({}, out);
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("Created PHAX config:"))).toBe(true);
    expect(lines.some((l) => l.includes("Created JSON Schema:"))).toBe(true);
    expect(lines.some((l) => l.includes("Schema: local generated schema"))).toBe(true);
  });

  it("returns 1 with already-initialized message on second call (no force)", async () => {
    const { out } = makeFakeOut();
    await runInit({}, out);

    const { out: out2, errors } = makeFakeOut();
    const code = await runInit({}, out2);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("already initialized"))).toBe(true);
  });

  it("returns 0 when force is set over an existing config", async () => {
    const { out } = makeFakeOut();
    await runInit({}, out);

    const { out: out2, lines } = makeFakeOut();
    const code = await runInit({ force: true }, out2);
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("Created PHAX config:"))).toBe(true);
  });

  it("prints the phax.json path relative to cwd", async () => {
    const { out, lines } = makeFakeOut();
    await runInit({}, out);
    const configLine = lines.find((l) => l.includes("Created PHAX config:"));
    expect(configLine).toBeDefined();
    expect(configLine).toContain(join(tmpDir, "phax.json"));
  });
});
