import { describe, expect, it } from "vitest";
import { resolveGateProfile } from "../../src/app/gates.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";

function makeConfig(overrides?: Partial<ResolvedConfig["raw"]>): ResolvedConfig {
  const raw = {
    version: 1 as const,
    project: { name: "test-project", type: "single-package" as const },
    state: { root: "~/.phax" },
    gateProfiles: {
      fast: ["pnpm test"],
      full: ["pnpm test", "pnpm lint"],
    },
    ...overrides,
  };
  return {
    raw,
    stateRoot: "/home/user/.phax",
    repoRoot: "/home/user/repo",
    editorCommand: "zed",
    backend: "claude-code-cli",
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
  };
}

describe("resolveGateProfile", () => {
  it("resolves a top-level gate profile by id", () => {
    const config = makeConfig();
    const commands = resolveGateProfile(config, "fast");
    expect(commands).toEqual(["pnpm test"]);
  });

  it("resolves the full profile", () => {
    const config = makeConfig();
    const commands = resolveGateProfile(config, "full");
    expect(commands).toEqual(["pnpm test", "pnpm lint"]);
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
            fast: ["pnpm test --filter=frontend"],
          },
        },
      ],
    });
    const commands = resolveGateProfile(config, "fast", "frontend");
    expect(commands).toEqual(["pnpm test --filter=frontend"]);
  });

  it("falls back to top-level profile when workspace has no matching profile", () => {
    const config = makeConfig({
      workspaces: [
        {
          id: "frontend",
          name: "Frontend",
          path: "./packages/ui",
          gateProfiles: {
            custom: ["pnpm custom"],
          },
        },
      ],
    });
    const commands = resolveGateProfile(config, "fast", "frontend");
    expect(commands).toEqual(["pnpm test"]);
  });

  it("falls back to top-level profile when workspaceId does not exist", () => {
    const config = makeConfig();
    const commands = resolveGateProfile(config, "fast", "nonexistent-workspace");
    expect(commands).toEqual(["pnpm test"]);
  });

  it("falls back to top-level when workspace gateProfiles is undefined", () => {
    const config = makeConfig({
      workspaces: [{ id: "backend", name: "Backend", path: "./packages/api" }],
    });
    const commands = resolveGateProfile(config, "fast", "backend");
    expect(commands).toEqual(["pnpm test"]);
  });
});
