import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { phaxCall } from "../../helpers/runnerCall.js";

describe("schema upgrade", () => {
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

  it("returns 1 and prints an error when no phax.json exists", async () => {
    const { code, errLines: errors } = await phaxCall(["schema", "upgrade"]);
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes("phax init"))).toBe(true);
  });

  it("returns 0 and prints Updated when schema is written for the first time", async () => {
    writeFileSync(join(tmpDir, "phax.json"), JSON.stringify({ version: 1 }));
    const { code, outLines: lines } = await phaxCall(["schema", "upgrade"]);
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith("Updated "))).toBe(true);
  });

  it("returns 0 and prints already up to date on second call", async () => {
    writeFileSync(join(tmpDir, "phax.json"), JSON.stringify({ version: 1 }));
    await phaxCall(["schema", "upgrade"]);
    const { code, outLines: lines } = await phaxCall(["schema", "upgrade"]);
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("already up to date"))).toBe(true);
  });
});
