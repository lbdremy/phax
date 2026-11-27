import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectiveStateRoot } from "../../src/app/projectContext.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { resolveRecordsConfig } from "../../src/schemas/recordsConfig.js";

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
  codeReview: resolveCodeReviewConfig(undefined),
  authoring: resolveAuthoringConfig(undefined),
  records: resolveRecordsConfig(undefined),
};

let savedPhaxHome: string | undefined;

beforeEach(() => {
  savedPhaxHome = process.env["PHAX_HOME"];
});

afterEach(() => {
  if (savedPhaxHome === undefined) delete process.env["PHAX_HOME"];
  else process.env["PHAX_HOME"] = savedPhaxHome;
});

describe("effectiveStateRoot", () => {
  it("returns the config stateRoot when a config is provided", () => {
    const config: ResolvedConfig = { ...minimalConfig, stateRoot: "/custom/state" };
    expect(effectiveStateRoot(config)).toBe("/custom/state");
  });

  it("returns the default ~/.phax when config is undefined and PHAX_HOME is unset", () => {
    delete process.env["PHAX_HOME"];
    expect(effectiveStateRoot(undefined)).toBe(join(homedir(), ".phax"));
  });

  it("returns PHAX_HOME when config is undefined and PHAX_HOME is set", () => {
    const moved = mkdtempSync(join(tmpdir(), "phax-ctx-home-"));
    try {
      process.env["PHAX_HOME"] = moved;
      expect(effectiveStateRoot(undefined)).toBe(moved);
    } finally {
      rmSync(moved, { recursive: true, force: true });
    }
  });

  it("falls back to the default ~/.phax when PHAX_HOME is invalid", () => {
    process.env["PHAX_HOME"] = "relative/home";
    expect(effectiveStateRoot(undefined)).toBe(join(homedir(), ".phax"));
  });

  it("returns the config stateRoot over PHAX_HOME", () => {
    process.env["PHAX_HOME"] = "/somewhere/else";
    const config: ResolvedConfig = { ...minimalConfig, stateRoot: "/custom/state" };
    expect(effectiveStateRoot(config)).toBe("/custom/state");
  });
});
