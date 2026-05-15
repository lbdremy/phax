import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Either } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/app/loadConfig.js";
import { DEFAULT_EXTRACT_MODEL } from "../../src/schemas/phaxConfig.js";

const baseConfig = {
  version: 1,
  project: { name: "test", type: "single-package" },
  state: { root: "~/.phax" },
  gateProfiles: { fast: ["pnpm test"] },
};

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "phax-loadconfig-test-"));
  execSync("git init", { cwd: repoDir, stdio: "ignore" });
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

function writePhaxJson(config: object): void {
  writeFileSync(join(repoDir, "phax.json"), JSON.stringify(config));
}

describe("loadConfig extractPlan resolution", () => {
  it("defaults to DEFAULT_EXTRACT_MODEL and low effort when no extractPlan config", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.extractPlanModel).toBe(DEFAULT_EXTRACT_MODEL);
      expect(result.right.extractPlanEffort).toBe("low");
    }
  });

  it("uses model from agent.extractPlan.model when set", () => {
    writePhaxJson({
      ...baseConfig,
      agent: {
        backend: "claude-code-cli",
        extractPlan: { model: "claude-sonnet-4-6" },
      },
    });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.extractPlanModel).toBe("claude-sonnet-4-6");
      expect(result.right.extractPlanEffort).toBe("low");
    }
  });

  it("uses effort from agent.extractPlan.effort when set", () => {
    writePhaxJson({
      ...baseConfig,
      agent: {
        backend: "claude-code-cli",
        extractPlan: { effort: "medium" },
      },
    });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.extractPlanModel).toBe(DEFAULT_EXTRACT_MODEL);
      expect(result.right.extractPlanEffort).toBe("medium");
    }
  });

  it("uses both model and effort from agent.extractPlan when both set", () => {
    writePhaxJson({
      ...baseConfig,
      agent: {
        backend: "claude-code-cli",
        extractPlan: { model: "claude-opus-4-7", effort: "high" },
      },
    });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.extractPlanModel).toBe("claude-opus-4-7");
      expect(result.right.extractPlanEffort).toBe("high");
    }
  });

  it("rejects agent.extractPlan with an invalid effort value", () => {
    writePhaxJson({
      ...baseConfig,
      agent: {
        backend: "claude-code-cli",
        extractPlan: { effort: "extreme" },
      },
    });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
  });
});
