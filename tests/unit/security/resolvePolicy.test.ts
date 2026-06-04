import { describe, expect, it } from "vitest";
import { resolveSecurityPolicy } from "../../../src/domain/security/resolvePolicy.js";
import type { ResolvedSecurityConfig } from "../../../src/schemas/securityConfig.js";

const baseSecureConfig: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only", allowDomains: [] },
  mcp: { mode: "disabled", allow: [] },
};

const devAllowlistConfig: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: ["/extra/read"], allowWrite: ["/extra/write"] },
  network: { profile: "dev-allowlist", allowDomains: ["example.com"] },
  mcp: { mode: "allowlist", allow: ["my-mcp"] },
};

describe("resolveSecurityPolicy — unsafe mode", () => {
  it("returns failClosed false", () => {
    const policy = resolveSecurityPolicy({
      mode: "unsafe",
      provider: "claude-code",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: baseSecureConfig,
    });
    expect(policy.failClosed).toBe(false);
    expect(policy.mode).toBe("unsafe");
  });

  it("returns empty allow-lists regardless of config", () => {
    const policy = resolveSecurityPolicy({
      mode: "unsafe",
      provider: "codex-cli",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: devAllowlistConfig,
    });
    expect(policy.filesystem.allowWrite).toEqual([]);
    expect(policy.filesystem.allowRead).toEqual([]);
    expect(policy.network.allowDomains).toEqual([]);
    expect(policy.mcp.allow).toEqual([]);
  });

  it("carries mode through as unsafe", () => {
    const policy = resolveSecurityPolicy({
      mode: "unsafe",
      provider: "mistral-vibe",
      worktreePath: "/repo",
      stateRoot: "/state",
      config: baseSecureConfig,
    });
    expect(policy.mode).toBe("unsafe");
  });
});

describe("resolveSecurityPolicy — secure mode, provider-only network", () => {
  it("includes worktree and stateRoot in allowWrite", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "claude-code",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: baseSecureConfig,
    });
    expect(policy.filesystem.allowWrite).toContain("/repo/worktree");
    expect(policy.filesystem.allowWrite).toContain("/home/user/.phax");
  });

  it("allowRead is a superset of allowWrite", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "claude-code",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: baseSecureConfig,
    });
    for (const path of policy.filesystem.allowWrite) {
      expect(policy.filesystem.allowRead).toContain(path);
    }
  });

  it("includes only the provider API domain in allowDomains when profile is provider-only", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "claude-code",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: baseSecureConfig,
    });
    expect(policy.network.allowDomains).toEqual(["api.anthropic.com"]);
  });

  it("uses the correct provider domain for codex-cli", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "codex-cli",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: baseSecureConfig,
    });
    expect(policy.network.allowDomains).toContain("api.openai.com");
    expect(policy.network.allowDomains).not.toContain("api.anthropic.com");
  });

  it("uses the correct provider domain for mistral-vibe", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "mistral-vibe",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: baseSecureConfig,
    });
    expect(policy.network.allowDomains).toContain("api.mistral.ai");
  });

  it("sets failClosed to true", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "claude-code",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: baseSecureConfig,
    });
    expect(policy.failClosed).toBe(true);
  });

  it("applies mcp from config", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "claude-code",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: baseSecureConfig,
    });
    expect(policy.mcp.mode).toBe("disabled");
    expect(policy.mcp.allow).toEqual([]);
  });

  it("de-duplicates paths when worktree equals stateRoot", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "claude-code",
      worktreePath: "/shared",
      stateRoot: "/shared",
      config: baseSecureConfig,
    });
    const writeCount = policy.filesystem.allowWrite.filter((p) => p === "/shared").length;
    expect(writeCount).toBe(1);
  });

  it("includes configured extra write paths", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "claude-code",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: devAllowlistConfig,
    });
    expect(policy.filesystem.allowWrite).toContain("/extra/write");
  });
});

describe("resolveSecurityPolicy — secure mode, dev-allowlist network", () => {
  it("includes provider domain and configured extra domains", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "claude-code",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: devAllowlistConfig,
    });
    expect(policy.network.allowDomains).toContain("api.anthropic.com");
    expect(policy.network.allowDomains).toContain("example.com");
    expect(policy.network.profile).toBe("dev-allowlist");
  });

  it("applies mcp allowlist from config", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      provider: "claude-code",
      worktreePath: "/repo/worktree",
      stateRoot: "/home/user/.phax",
      config: devAllowlistConfig,
    });
    expect(policy.mcp.mode).toBe("allowlist");
    expect(policy.mcp.allow).toEqual(["my-mcp"]);
  });
});
