import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { phaxCall } from "../../helpers/runnerCall.js";

describe("phax init", () => {
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
    const { code, outLines: lines } = await phaxCall(["init"]);
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("Created PHAX config:"))).toBe(true);
    expect(lines.some((l) => l.includes("Created JSON Schema:"))).toBe(true);
    expect(lines.some((l) => l.includes("Schema: local generated schema"))).toBe(true);
  });

  it("returns 1 with already-initialized message on second call (no force)", async () => {
    await phaxCall(["init"]);

    const { code, errLines: errors } = await phaxCall(["init"]);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("already initialized"))).toBe(true);
  });

  it("returns 0 when force is set over an existing config", async () => {
    await phaxCall(["init"]);

    const { code, outLines: lines } = await phaxCall(["init", "--force"]);
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("Created PHAX config:"))).toBe(true);
  });

  it("prints the phax.json path relative to cwd", async () => {
    const { outLines: lines } = await phaxCall(["init"]);
    const configLine = lines.find((l) => l.includes("Created PHAX config:"));
    expect(configLine).toBeDefined();
    expect(configLine).toContain(join(tmpDir, "phax.json"));
  });
});
