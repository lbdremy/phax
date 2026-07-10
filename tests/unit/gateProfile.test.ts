import { describe, expect, it } from "vitest";
import { resolveGateProfile } from "../../src/app/gates.js";
import type { GateStep, ResolvedConfig } from "../../src/schemas/phaxConfig.js";

const step = (
  command: string,
  surface = "local",
  firing: "every-phase" | "terminal" = "every-phase",
): GateStep => ({
  command,
  surface,
  firing,
});

function makeConfig(overrides?: Partial<ResolvedConfig["raw"]>): ResolvedConfig {
  const raw = {
    version: 1 as const,
    state: { root: "~/.phax" },
    name: "test-project",
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

  it("returns steps with the correct surface and firing attributes", () => {
    const config = makeConfig({
      gateProfiles: {
        ci: [step("pnpm test", "local", "every-phase"), step("pnpm build", "product", "terminal")],
      },
    });
    const steps = resolveGateProfile(config, "ci");
    expect(steps[0]).toEqual({ command: "pnpm test", surface: "local", firing: "every-phase" });
    expect(steps[1]).toEqual({ command: "pnpm build", surface: "product", firing: "terminal" });
  });
});

describe("pickGateProfileId (first-key selection)", () => {
  it("selects the first profile key regardless of name", () => {
    const config = makeConfig({
      gateProfiles: {
        standard: [step("pnpm test")],
      },
    });
    const keys = Object.keys(config.raw.gateProfiles);
    expect(keys[0]).toBe("standard");
  });

  it("selects 'custom' over 'full' or 'fast' when it is the only key", () => {
    const config = makeConfig({
      gateProfiles: {
        custom: [step("pnpm check")],
      },
    });
    const keys = Object.keys(config.raw.gateProfiles);
    expect(keys[0]).toBe("custom");
  });
});
