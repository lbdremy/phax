import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAgentErrorLog } from "../../src/infra/providers/agentErrorLog.js";

describe("writeAgentErrorLog", () => {
  it("writes argv, exit code, and stderr to agent-error.log", () => {
    const dir = mkdtempSync(join(tmpdir(), "phax-test-"));
    const argv = ["claude", "--print", "--model", "claude-sonnet-4-6"];
    const stderr = "Error: authentication failed\nDetails: invalid key";

    writeAgentErrorLog(dir, { argv, exitCode: 1, stderr });

    const content = readFileSync(join(dir, "agent-error.log"), "utf8");
    expect(content).toContain(argv.join(" "));
    expect(content).toContain("exit code: 1");
    expect(content).toContain(stderr);
  });

  it("uses 'unknown' exit code when exitCode is undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "phax-test-"));

    writeAgentErrorLog(dir, { argv: ["claude"], stderr: "spawn error" });

    const content = readFileSync(join(dir, "agent-error.log"), "utf8");
    expect(content).toContain("exit code: unknown");
  });

  it("is a no-op when phaseFolderPath is undefined", () => {
    expect(() =>
      writeAgentErrorLog(undefined, { argv: ["claude"], exitCode: 1, stderr: "err" }),
    ).not.toThrow();
  });

  it("never throws when the path is unwritable", () => {
    const dir = mkdtempSync(join(tmpdir(), "phax-test-"));
    const fileNotDir = join(dir, "blockfile");
    writeFileSync(fileNotDir, "I am a file, not a directory");
    // phaseFolderPath is inside a file — mkdirSync will fail
    expect(() =>
      writeAgentErrorLog(join(fileNotDir, "subdir"), { argv: ["claude"], exitCode: 1 }),
    ).not.toThrow();
  });
});
