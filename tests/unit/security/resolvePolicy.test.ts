import { describe, expect, it } from "vitest";
import { resolveSecurityPolicy } from "../../../src/domain/security/resolvePolicy.js";
import type { ResolvedSecurityConfig } from "../../../src/schemas/securityConfig.js";

const baseSecureConfig: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
};

const devAllowlistConfig: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: ["/extra/read"], allowWrite: ["/extra/write"] },
  network: { profile: "dev-allowlist" },
  mcp: { mode: "allowlist", allow: ["my-mcp"] },
};

describe("resolveSecurityPolicy — unsafe mode", () => {
  it("returns failClosed false", () => {
    const policy = resolveSecurityPolicy({
      mode: "unsafe",
      worktreePath: "/repo/worktree",
      config: baseSecureConfig,
    });
    expect(policy.failClosed).toBe(false);
    expect(policy.mode).toBe("unsafe");
  });

  it("returns empty allow-lists regardless of config", () => {
    const policy = resolveSecurityPolicy({
      mode: "unsafe",
      worktreePath: "/repo/worktree",
      config: devAllowlistConfig,
    });
    expect(policy.filesystem.allowWrite).toEqual([]);
    expect(policy.filesystem.allowRead).toEqual([]);
    expect(policy.mcp.allow).toEqual([]);
  });

  it("carries mode through as unsafe", () => {
    const policy = resolveSecurityPolicy({
      mode: "unsafe",
      worktreePath: "/repo",
      config: baseSecureConfig,
    });
    expect(policy.mode).toBe("unsafe");
  });
});

describe("resolveSecurityPolicy — secure mode, provider-only network", () => {
  it("includes the worktree in allowWrite", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/worktree",
      config: baseSecureConfig,
    });
    expect(policy.filesystem.allowWrite).toContain("/repo/worktree");
  });

  it("does NOT grant the phax state root by default (only the worktree + config)", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/home/user/.phax/worktrees/run/phase-01",
      config: baseSecureConfig,
    });
    // The whole state root must never leak in implicitly — the worktree (which
    // lives under it) is the only default grant.
    expect(policy.filesystem.allowWrite).toEqual(["/home/user/.phax/worktrees/run/phase-01"]);
    expect(policy.filesystem.allowWrite).not.toContain("/home/user/.phax");
    expect(policy.filesystem.allowRead).not.toContain("/home/user/.phax");
  });

  it("grants the state root only when a project opts in via config.allowWrite", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/home/user/.phax/worktrees/run/phase-01",
      config: {
        ...baseSecureConfig,
        filesystem: { allowRead: [], allowWrite: ["/home/user/.phax"] },
      },
    });
    expect(policy.filesystem.allowWrite).toContain("/home/user/.phax");
  });

  it("allowRead is a superset of allowWrite", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/worktree",
      config: baseSecureConfig,
    });
    for (const path of policy.filesystem.allowWrite) {
      expect(policy.filesystem.allowRead).toContain(path);
    }
  });

  it("carries the network profile (no domain allowlist exists)", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/worktree",
      config: baseSecureConfig,
    });
    expect(policy.network.profile).toBe("provider-only");
    expect(policy.network).not.toHaveProperty("allowDomains");
  });

  it("is provider-independent: same config yields the same policy", () => {
    const a = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/worktree",
      config: baseSecureConfig,
    });
    const b = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/worktree",
      config: baseSecureConfig,
    });
    expect(a).toEqual(b);
  });

  it("sets failClosed to true", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/worktree",
      config: baseSecureConfig,
    });
    expect(policy.failClosed).toBe(true);
  });

  it("applies mcp from config", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/worktree",
      config: baseSecureConfig,
    });
    expect(policy.mcp.mode).toBe("disabled");
    expect(policy.mcp.allow).toEqual([]);
  });

  it("de-duplicates paths when the worktree is also a configured write path", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/shared",
      config: {
        ...baseSecureConfig,
        filesystem: { allowRead: [], allowWrite: ["/shared"] },
      },
    });
    const writeCount = policy.filesystem.allowWrite.filter((p) => p === "/shared").length;
    expect(writeCount).toBe(1);
  });

  it("includes configured extra write paths", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/worktree",
      config: devAllowlistConfig,
    });
    expect(policy.filesystem.allowWrite).toContain("/extra/write");
  });
});

describe("resolveSecurityPolicy — secure mode, dev-allowlist network", () => {
  it("carries the dev-allowlist network profile", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/worktree",
      config: devAllowlistConfig,
    });
    expect(policy.network.profile).toBe("dev-allowlist");
  });

  it("applies mcp allowlist from config", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/worktree",
      config: devAllowlistConfig,
    });
    expect(policy.mcp.mode).toBe("allowlist");
    expect(policy.mcp.allow).toEqual(["my-mcp"]);
  });
});
