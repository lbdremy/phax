import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Either } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, describeConfigSources } from "../../src/app/loadConfig.js";
import { DEFAULT_EXTRACT_MODEL, DEFAULT_CODE_REVIEW_MODEL } from "../../src/schemas/phaxConfig.js";
import { DEFAULT_SECURITY_PROFILE } from "../../src/schemas/securityConfig.js";

const baseConfig = {
  version: 1,
  name: "test",
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

describe("loadConfig namespace resolution", () => {
  it("exposes namespace from top-level name field", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.namespace).toBe("test");
    }
  });

  it("returns ConfigValidationError with path 'name' when name is missing", () => {
    const { name: _, ...noName } = baseConfig;
    writePhaxJson(noName);
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("name");
    }
  });

  it("returns ConfigValidationError with path 'name' when name is empty", () => {
    writePhaxJson({ ...baseConfig, name: "" });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("name");
    }
  });

  it("returns ConfigValidationError with path 'name' when name contains a dot", () => {
    writePhaxJson({ ...baseConfig, name: "my.project" });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("name");
    }
  });

  it("returns ConfigValidationError with path 'name' when name has uppercase", () => {
    writePhaxJson({ ...baseConfig, name: "MyProject" });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("name");
    }
  });

  it("returns ConfigValidationError with path 'name' when name starts with a digit", () => {
    writePhaxJson({ ...baseConfig, name: "1project" });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.path).toBe("name");
    }
  });

  it("includes the spec error message when name is missing", () => {
    const { name: _, ...noName } = baseConfig;
    writePhaxJson(noName);
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("PHAX project name is missing");
    }
  });
});

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
        extractPlan: { effort: "extreme" },
      },
    });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("loadConfig fileReconciliation resolution", () => {
  it("defaults fileReconciliationMode to report_only when not set", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.fileReconciliationMode).toBe("report_only");
    }
  });

  it("resolves fileReconciliationMode to warn when configured", () => {
    writePhaxJson({ ...baseConfig, fileReconciliation: { mode: "warn" } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.fileReconciliationMode).toBe("warn");
    }
  });

  it("resolves fileReconciliationMode to report_only when explicitly set", () => {
    writePhaxJson({ ...baseConfig, fileReconciliation: { mode: "report_only" } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.fileReconciliationMode).toBe("report_only");
    }
  });
});

describe("describeConfigSources", () => {
  it("returns undefined when no phax.json exists", () => {
    const result = describeConfigSources(repoDir);
    expect(result).toBeUndefined();
  });

  it("returns project path with undefined overlays when no overlays exist", () => {
    writePhaxJson(baseConfig);
    const result = describeConfigSources(repoDir);
    expect(result).toBeDefined();
    if (result) {
      expect(result.project).toBe(join(repoDir, "phax.json"));
      expect(result.localOverlay).toBeUndefined();
      // globalOverlay may or may not exist depending on the test machine; we just check it's string or undefined
      expect(typeof result.globalOverlay === "string" || result.globalOverlay === undefined).toBe(
        true,
      );
    }
  });

  it("sets localOverlay when phax.local.json exists", () => {
    writePhaxJson(baseConfig);
    const localPath = join(repoDir, "phax.local.json");
    writeFileSync(localPath, JSON.stringify({ version: 1 }));
    const result = describeConfigSources(repoDir);
    expect(result).toBeDefined();
    if (result) {
      expect(result.localOverlay).toBe(localPath);
    }
  });

  it("returns undefined when not inside a git repo", () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "phax-no-git-"));
    try {
      const result = describeConfigSources(nonRepo);
      expect(result).toBeUndefined();
    } finally {
      rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});

describe("loadConfig security resolution", () => {
  it("defaults security profile to secure when no security block", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.security.profile).toBe("secure");
    }
  });

  it("uses the profile from the security block when set", () => {
    writePhaxJson({ ...baseConfig, security: { profile: "secure" } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.security.profile).toBe("secure");
    }
  });

  it("defaults network profile to provider-only and mcp mode to disabled", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.security.network.profile).toBe("provider-only");
      expect(result.right.security.mcp.mode).toBe("disabled");
    }
  });

  it("defaults all allow-lists to empty arrays", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.security.filesystem.allowRead).toEqual([]);
      expect(result.right.security.filesystem.allowWrite).toEqual([]);
      expect(result.right.security.mcp.allow).toEqual([]);
    }
  });

  it("resolves relative filesystem allowWrite paths against gitRoot", () => {
    writePhaxJson({
      ...baseConfig,
      security: { filesystem: { allowWrite: ["relative/path"] } },
    });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const write = result.right.security.filesystem.allowWrite;
      // Use realpathSync to resolve macOS /tmp → /private/tmp symlink
      const realRepoDir = realpathSync(repoDir);
      expect(write.length).toBe(1);
      expect(write[0]).toBe(`${realRepoDir}/relative/path`);
    }
  });

  it("rejects an unknown security profile value", () => {
    writePhaxJson({ ...baseConfig, security: { profile: "super-safe" } });
    const result = loadConfig(repoDir);
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("loadConfig codeReview defaults", () => {
  it("defaults codeReview to claude-opus-4-8 and high effort when no review.code block", () => {
    writePhaxJson(baseConfig);
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.codeReview.model).toBe(DEFAULT_CODE_REVIEW_MODEL);
      expect(result.right.codeReview.effort).toBe("high");
    }
  });

  it("honors review.code.model when set", () => {
    writePhaxJson({ ...baseConfig, review: { code: { model: "claude-sonnet-4-6" } } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.codeReview.model).toBe("claude-sonnet-4-6");
      expect(result.right.codeReview.effort).toBe("high");
    }
  });

  it("honors review.code.effort when set", () => {
    writePhaxJson({ ...baseConfig, review: { code: { effort: "medium" } } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.codeReview.model).toBe(DEFAULT_CODE_REVIEW_MODEL);
      expect(result.right.codeReview.effort).toBe("medium");
    }
  });
});
