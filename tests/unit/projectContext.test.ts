import { join } from "node:path";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { effectiveStateRoot } from "../../src/app/projectContext.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";

const minimalConfig = {
  raw: {} as ResolvedConfig["raw"],
  namespace: "myproject",
  repoRoot: "/repo",
  maxFixAttempts: 1,
  extractPlanModel: "claude-haiku-4-5-20251001",
  extractPlanEffort: "low" as const,
  fileReconciliationMode: "report_only" as const,
  security: {} as ResolvedConfig["security"],
  publish: {} as ResolvedConfig["publish"],
  complianceReview: {} as ResolvedConfig["complianceReview"],
};

describe("effectiveStateRoot", () => {
  it("returns the config stateRoot when a config is provided", () => {
    const config: ResolvedConfig = { ...minimalConfig, stateRoot: "/custom/state" };
    expect(effectiveStateRoot(config)).toBe("/custom/state");
  });

  it("returns the default ~/.phax when config is undefined", () => {
    const expected = join(homedir(), ".phax");
    expect(effectiveStateRoot(undefined)).toBe(expected);
  });

  it("returns a tilde-expanded path when stateRoot uses tilde", () => {
    const config: ResolvedConfig = { ...minimalConfig, stateRoot: join(homedir(), ".phax") };
    expect(effectiveStateRoot(config)).toBe(join(homedir(), ".phax"));
  });
});
