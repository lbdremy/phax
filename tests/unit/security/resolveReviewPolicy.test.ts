import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveReviewSecurityPolicy } from "../../../src/domain/security/resolveReviewPolicy.js";
import type { ResolvedSecurityConfig } from "../../../src/schemas/securityConfig.js";

const baseConfig: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [], allowWriteProtected: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

const worktreePath = "/home/user/.phax/worktrees/my-run/phase-02";

describe("resolveReviewSecurityPolicy — allowWrite is only .phax-context", () => {
  it("allowWrite contains only <worktreePath>/.phax-context", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath,
      config: baseConfig,
    });
    expect(policy.filesystem.allowWrite).toEqual([join(worktreePath, ".phax-context")]);
  });

  it("allowWrite does NOT contain the worktree root", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath,
      config: baseConfig,
    });
    expect(policy.filesystem.allowWrite).not.toContain(worktreePath);
  });

  it("allowWrite does NOT contain extra config write paths", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath,
      config: {
        ...baseConfig,
        filesystem: { allowRead: [], allowWrite: ["/extra/path"], allowWriteProtected: [] },
      },
    });
    expect(policy.filesystem.allowWrite).not.toContain("/extra/path");
    expect(policy.filesystem.allowWrite).toEqual([join(worktreePath, ".phax-context")]);
  });
});

describe("resolveReviewSecurityPolicy — allowRead contains the worktree", () => {
  it("allowRead contains the worktree path", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath,
      config: baseConfig,
    });
    expect(policy.filesystem.allowRead).toContain(worktreePath);
  });

  it("allowRead includes config.filesystem.allowRead entries", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath,
      config: {
        ...baseConfig,
        filesystem: { allowRead: ["/extra/read"], allowWrite: [], allowWriteProtected: [] },
      },
    });
    expect(policy.filesystem.allowRead).toContain("/extra/read");
  });

  it("allowRead is a superset of allowWrite", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath,
      config: baseConfig,
    });
    for (const path of policy.filesystem.allowWrite) {
      expect(policy.filesystem.allowRead).toContain(path);
    }
  });
});

describe("resolveReviewSecurityPolicy — fixed overrides", () => {
  it("failClosed is true", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath,
      config: baseConfig,
    });
    expect(policy.failClosed).toBe(true);
  });

  it("network.profile is provider-only regardless of config", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath,
      config: { ...baseConfig, network: { profile: "dev-allowlist" } },
    });
    expect(policy.network.profile).toBe("provider-only");
  });

  it("mcp.mode is disabled regardless of config", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath,
      config: { ...baseConfig, mcp: { mode: "allowlist", allow: ["my-mcp"] } },
    });
    expect(policy.mcp.mode).toBe("disabled");
  });

  it("carries the input mode through on the policy", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "unsafe",
      worktreePath,
      config: baseConfig,
    });
    expect(policy.mode).toBe("unsafe");
  });
});

describe("resolveReviewSecurityPolicy — agentCommands", () => {
  it("includes git for read-only inspection", () => {
    const policy = resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath,
      config: baseConfig,
    });
    expect(policy.agentCommands).toContain("git");
  });
});

describe("resolveReviewSecurityPolicy — determinism", () => {
  it("returns the same policy for the same input", () => {
    const a = resolveReviewSecurityPolicy({ mode: "secure", worktreePath, config: baseConfig });
    const b = resolveReviewSecurityPolicy({ mode: "secure", worktreePath, config: baseConfig });
    expect(a).toEqual(b);
  });
});
