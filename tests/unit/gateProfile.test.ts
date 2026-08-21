import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { resolveGateProfile } from "../../src/app/gates.js";
import {
  decodePhaxConfig,
  type GateStep,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";

function step(command: string, surface: GateStep["surface"] = "local"): GateStep {
  return { command, surface, firing: "every-phase", output: "log" };
}

function makeConfig(overrides?: Partial<ResolvedConfig["raw"]>): ResolvedConfig {
  const raw = {
    version: 1 as const,
    project: { name: "test-project", type: "single-package" as const },
    state: { root: "~/.phax" },
    gateProfiles: {
      fast: [step("pnpm test")],
      full: [step("pnpm test"), step("pnpm lint")],
    },
    ...overrides,
  };
  return {
    raw,
    stateRoot: "/home/user/.phax",
    repoRoot: "/home/user/repo",
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,

    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only", allowDomains: [] },
      mcp: { mode: "disabled", allow: [] },
    },
  };
}

describe("resolveGateProfile", () => {
  it("resolves a top-level gate profile by id", () => {
    const config = makeConfig();
    const steps = resolveGateProfile(config, "fast");
    expect(steps).toEqual([step("pnpm test")]);
  });

  it("resolves the full profile", () => {
    const config = makeConfig();
    const steps = resolveGateProfile(config, "full");
    expect(steps).toEqual([step("pnpm test"), step("pnpm lint")]);
  });

  it("throws when the profile does not exist", () => {
    const config = makeConfig();
    expect(() => resolveGateProfile(config, "nonexistent")).toThrow(
      'Gate profile "nonexistent" not found or empty',
    );
  });

  it("prefers the workspace gate profile when workspaceId matches", () => {
    const config = makeConfig({
      workspaces: [
        {
          id: "frontend",
          name: "Frontend",
          path: "./packages/ui",
          gateProfiles: {
            fast: [step("pnpm test --filter=frontend")],
          },
        },
      ],
    });
    const steps = resolveGateProfile(config, "fast", "frontend");
    expect(steps).toEqual([step("pnpm test --filter=frontend")]);
  });

  it("falls back to top-level profile when workspace has no matching profile", () => {
    const config = makeConfig({
      workspaces: [
        {
          id: "frontend",
          name: "Frontend",
          path: "./packages/ui",
          gateProfiles: {
            custom: [step("pnpm custom")],
          },
        },
      ],
    });
    const steps = resolveGateProfile(config, "fast", "frontend");
    expect(steps).toEqual([step("pnpm test")]);
  });

  it("falls back to top-level profile when workspaceId does not exist", () => {
    const config = makeConfig();
    const steps = resolveGateProfile(config, "fast", "nonexistent-workspace");
    expect(steps).toEqual([step("pnpm test")]);
  });

  it("falls back to top-level when workspace gateProfiles is undefined", () => {
    const config = makeConfig({
      workspaces: [{ id: "backend", name: "Backend", path: "./packages/api" }],
    });
    const steps = resolveGateProfile(config, "fast", "backend");
    expect(steps).toEqual([step("pnpm test")]);
  });
});

describe("gate profile decode (attributed steps)", () => {
  const baseConfig = {
    version: 1,
    name: "test-project",
    security: { agentCommands: [] },
  };

  it("accepts a profile of attributed steps", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
      },
    });
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("rejects the old flat-array (command-string) profile form, naming the profile", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: ["pnpm test", "pnpm lint"],
      },
    });
    expect(Either.isLeft(decoded)).toBe(true);
    if (Either.isLeft(decoded)) {
      const message = decoded.left.toString();
      // The decode-error path names the offending profile so the operator can
      // find the flat entry that must be migrated.
      expect(message).toContain("gateProfiles");
      expect(message).toContain("full");
    }
  });

  it("rejects a step whose surface is outside the closed enum", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [{ command: "pnpm test", surface: "cosmic", firing: "every-phase" }],
      },
    });
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a step whose firing is outside the closed enum", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [{ command: "pnpm test", surface: "local", firing: "sometimes" }],
      },
    });
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects an unknown step key (onExcessProperty: error)", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [{ command: "pnpm test", surface: "local", firing: "every-phase", extra: true }],
      },
    });
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("decodes a step without output to output: log", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
      },
    });
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.gateProfiles["full"]?.[0]?.output).toBe("log");
    }
  });

  it("decodes a step with output: diagnostics", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [
          {
            command: "pnpm test",
            surface: "local",
            firing: "every-phase",
            output: "diagnostics",
          },
        ],
      },
    });
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.gateProfiles["full"]?.[0]?.output).toBe("diagnostics");
    }
  });

  it("rejects a step whose output is outside the closed enum", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [{ command: "pnpm test", surface: "local", firing: "every-phase", output: "json" }],
      },
    });
    expect(Either.isLeft(decoded)).toBe(true);
  });
});
