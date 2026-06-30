import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { resolveSecurityConfig, SecurityConfigSchema } from "../../src/schemas/securityConfig.js";
import { resolveSecurityPolicy } from "../../src/domain/security/resolvePolicy.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";

const baseConfig: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [], allowWriteProtected: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

describe("resolveSecurityConfig — allowWriteProtected", () => {
  it("defaults to [] when filesystem is absent", () => {
    const resolved = resolveSecurityConfig(undefined, "secure");
    expect(resolved.filesystem.allowWriteProtected).toEqual([]);
  });

  it("defaults to [] when filesystem.allowWriteProtected is absent", () => {
    const resolved = resolveSecurityConfig({ filesystem: { allowRead: ["/foo"] } }, "secure");
    expect(resolved.filesystem.allowWriteProtected).toEqual([]);
  });

  it("passes a provided allowWriteProtected array through", () => {
    const resolved = resolveSecurityConfig(
      { filesystem: { allowWriteProtected: [".claude/skills/", ".claude/commands/"] } },
      "secure",
    );
    expect(resolved.filesystem.allowWriteProtected).toEqual([
      ".claude/skills/",
      ".claude/commands/",
    ]);
  });

  it("decodes through SecurityConfigSchema without error", () => {
    const raw = {
      security: {
        filesystem: {
          allowWriteProtected: [".claude/skills/"],
        },
      },
    };
    const decode = Schema.decodeUnknownSync(
      Schema.Struct({ security: Schema.optional(SecurityConfigSchema) }),
    );
    const result = decode(raw);
    expect(result.security?.filesystem?.allowWriteProtected).toEqual([".claude/skills/"]);
  });
});

describe("resolveSecurityPolicy — allowWriteProtected in secure mode", () => {
  it("carries allowWriteProtected from config into the policy", () => {
    const config: ResolvedSecurityConfig = {
      ...baseConfig,
      filesystem: { ...baseConfig.filesystem, allowWriteProtected: [".claude/skills/"] },
    };
    const policy = resolveSecurityPolicy({ mode: "secure", worktreePath: "/repo/wt", config });
    expect(policy.filesystem.allowWriteProtected).toEqual([".claude/skills/"]);
  });

  it("defaults to [] when config has no allowWriteProtected", () => {
    const policy = resolveSecurityPolicy({
      mode: "secure",
      worktreePath: "/repo/wt",
      config: baseConfig,
    });
    expect(policy.filesystem.allowWriteProtected).toEqual([]);
  });
});

describe("resolveSecurityPolicy — allowWriteProtected in unsafe mode", () => {
  it("is always [] in unsafe mode regardless of config", () => {
    const config: ResolvedSecurityConfig = {
      ...baseConfig,
      filesystem: { ...baseConfig.filesystem, allowWriteProtected: [".claude/skills/"] },
    };
    const policy = resolveSecurityPolicy({ mode: "unsafe", worktreePath: "/repo/wt", config });
    expect(policy.filesystem.allowWriteProtected).toEqual([]);
  });
});
