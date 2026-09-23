import { describe, expect, it } from "vitest";
import { mergeConfigLayers } from "../../src/domain/config/mergeLayers.js";
import type { GateStep, PhaxConfig, PhaxUserOverlay } from "../../src/schemas/phaxConfig.js";

function step(command: string): GateStep {
  return { command, surface: "local", firing: "every-phase", output: "log" };
}

function makeProject(overrides: Partial<PhaxConfig> = {}): PhaxConfig {
  return {
    version: 1,
    name: "test",
    gateProfiles: { fast: [step("pnpm test")] },
    ...overrides,
  } as PhaxConfig;
}

function makeOverlay(overrides: Partial<PhaxUserOverlay> = {}): PhaxUserOverlay {
  return overrides as PhaxUserOverlay;
}

describe("mergeConfigLayers", () => {
  describe("no user layers", () => {
    it("returns the project config unchanged (same reference)", () => {
      const project = makeProject();
      const result = mergeConfigLayers({ project });
      expect(result).toBe(project);
    });
  });

  describe("state.root scalar override", () => {
    it("local beats global beats project", () => {
      const project = makeProject({ state: { root: "~/.project" } });
      const globalUser = makeOverlay({ state: { root: "~/.global" } });
      const localUser = makeOverlay({ state: { root: "~/.local" } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.state?.root).toBe("~/.local");
    });

    it("global beats project when no local", () => {
      const project = makeProject({ state: { root: "~/.project" } });
      const globalUser = makeOverlay({ state: { root: "~/.global" } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.state?.root).toBe("~/.global");
    });

    it("project value preserved when user layers do not set state", () => {
      const project = makeProject({ state: { root: "~/.project" } });
      const globalUser = makeOverlay({ agent: { maxFixAttempts: 2 } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.state?.root).toBe("~/.project");
    });

    it("state is absent in merged result when no layer sets it", () => {
      const project = makeProject();
      const globalUser = makeOverlay({ agent: { maxFixAttempts: 2 } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.state).toBeUndefined();
    });
  });

  describe("agent scalar overrides", () => {
    it("local maxFixAttempts beats global beats project", () => {
      const project = makeProject({ agent: { maxFixAttempts: 1 } });
      const globalUser = makeOverlay({ agent: { maxFixAttempts: 5 } });
      const localUser = makeOverlay({ agent: { maxFixAttempts: 3 } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.agent?.maxFixAttempts).toBe(3);
    });

    it("global maxFixAttempts beats project when no local", () => {
      const project = makeProject({ agent: { maxFixAttempts: 1 } });
      const globalUser = makeOverlay({ agent: { maxFixAttempts: 5 } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.agent?.maxFixAttempts).toBe(5);
    });

    it("local extractPlan overrides project", () => {
      const project = makeProject({
        agent: { extractPlan: { model: "fast-model", effort: "low" } },
      });
      const localUser = makeOverlay({
        agent: { extractPlan: { model: "slow-model", effort: "high" } },
      });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.agent?.extractPlan?.model).toBe("slow-model");
      expect(result.agent?.extractPlan?.effort).toBe("high");
    });

    it("individual extractPlan fields are independently overridable", () => {
      const project = makeProject({
        agent: { extractPlan: { model: "base-model", effort: "low" } },
      });
      const localUser = makeOverlay({ agent: { extractPlan: { effort: "high" } } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.agent?.extractPlan?.model).toBe("base-model");
      expect(result.agent?.extractPlan?.effort).toBe("high");
    });
  });

  describe("security.profile scalar override", () => {
    it("local profile beats project", () => {
      const project = makeProject({ security: { profile: "secure" } });
      const localUser = makeOverlay({ security: { profile: "unsafe" } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.security?.profile).toBe("unsafe");
    });
  });

  describe("allowlist union: security.filesystem", () => {
    it("unions allowRead across all layers preserving first-seen order", () => {
      const project = makeProject({ security: { filesystem: { allowRead: ["a", "b"] } } });
      const globalUser = makeOverlay({ security: { filesystem: { allowRead: ["b", "c"] } } });
      const localUser = makeOverlay({ security: { filesystem: { allowRead: ["c", "d"] } } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.security?.filesystem?.allowRead).toEqual(["a", "b", "c", "d"]);
    });

    it("unions allowWrite across all layers, deduplicating", () => {
      const project = makeProject({
        security: { filesystem: { allowWrite: ["dist/", "~/.phax"] } },
      });
      const globalUser = makeOverlay({
        security: { filesystem: { allowWrite: ["~/.phax", "tmp/"] } },
      });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.security?.filesystem?.allowWrite).toEqual(["dist/", "~/.phax", "tmp/"]);
    });

    it("user layer can only add to the project allowlist, never remove", () => {
      const project = makeProject({ security: { filesystem: { allowWrite: ["dist/"] } } });
      const localUser = makeOverlay({ security: { filesystem: { allowWrite: ["out/"] } } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.security?.filesystem?.allowWrite).toContain("dist/");
      expect(result.security?.filesystem?.allowWrite).toContain("out/");
    });

    it("preserves project allowRead when user layers have no filesystem", () => {
      const project = makeProject({ security: { filesystem: { allowRead: ["src/"] } } });
      const globalUser = makeOverlay({ security: { profile: "secure" } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.security?.filesystem?.allowRead).toEqual(["src/"]);
    });
  });

  describe("allowlist union: agentCommands and mcp.allow", () => {
    it("unions agentCommands across all layers", () => {
      const project = makeProject({ security: { agentCommands: ["curl"] } });
      const globalUser = makeOverlay({ security: { agentCommands: ["wget"] } });
      const localUser = makeOverlay({ security: { agentCommands: ["curl", "nc"] } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.security?.agentCommands).toEqual(["curl", "wget", "nc"]);
    });

    it("unions mcp.allow across all layers", () => {
      const project = makeProject({ security: { mcp: { allow: ["mcp-a"] } } });
      const globalUser = makeOverlay({ security: { mcp: { allow: ["mcp-b"] } } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.security?.mcp?.allow).toEqual(["mcp-a", "mcp-b"]);
    });

    it("mcp.mode is a scalar override (highest layer wins)", () => {
      const project = makeProject({ security: { mcp: { mode: "disabled" } } });
      const localUser = makeOverlay({ security: { mcp: { mode: "allowlist" } } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.security?.mcp?.mode).toBe("allowlist");
    });
  });

  describe("gateProfiles: union by key", () => {
    it("merges keys from all layers", () => {
      const project = makeProject({
        gateProfiles: { full: [step("pnpm check:full")] },
      });
      const globalUser = makeOverlay({ gateProfiles: { fast: [step("pnpm test:unit")] } });
      const localUser = makeOverlay({ gateProfiles: { dev: [step("pnpm dev")] } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.gateProfiles["full"]).toEqual([step("pnpm check:full")]);
      expect(result.gateProfiles["fast"]).toEqual([step("pnpm test:unit")]);
      expect(result.gateProfiles["dev"]).toEqual([step("pnpm dev")]);
    });

    it("higher layer wins for a shared profile key", () => {
      const project = makeProject({
        gateProfiles: { fast: [step("pnpm test")] },
      });
      const globalUser = makeOverlay({ gateProfiles: { fast: [step("pnpm test:unit")] } });
      const localUser = makeOverlay({ gateProfiles: { fast: [step("pnpm test:unit --run")] } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.gateProfiles["fast"]).toEqual([step("pnpm test:unit --run")]);
    });

    it("global overrides project for a shared key when no local", () => {
      const project = makeProject({
        gateProfiles: { fast: [step("pnpm test")] },
      });
      const globalUser = makeOverlay({ gateProfiles: { fast: [step("pnpm test:unit")] } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.gateProfiles["fast"]).toEqual([step("pnpm test:unit")]);
    });
  });

  describe("commands: per-field scalar override", () => {
    it("local setup replaces project setup", () => {
      const project = makeProject({
        commands: { setup: ["./setup.sh"] as const },
      });
      const localUser = makeOverlay({ commands: { setup: ["./local-setup.sh"] as const } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.commands?.setup).toEqual(["./local-setup.sh"]);
    });

    it("local override of one command field preserves the other from project", () => {
      const project = makeProject({
        commands: { setup: ["./setup.sh"] as const, cleanup: ["./cleanup.sh"] as const },
      });
      const localUser = makeOverlay({ commands: { setup: ["./local-setup.sh"] as const } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.commands?.setup).toEqual(["./local-setup.sh"]);
      expect(result.commands?.cleanup).toEqual(["./cleanup.sh"]);
    });
  });

  describe("workspaces: wholesale override", () => {
    const workspaceA = { id: "a", name: "A", path: "./a" };
    const workspaceB = { id: "b", name: "B", path: "./b" };

    it("local workspaces replace project workspaces entirely", () => {
      const project = makeProject({ workspaces: [workspaceA] });
      const localUser = makeOverlay({ workspaces: [workspaceB] });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.workspaces).toEqual([workspaceB]);
    });

    it("project workspaces preserved when user layers do not set workspaces", () => {
      const project = makeProject({ workspaces: [workspaceA] });
      const globalUser = makeOverlay({ security: { profile: "unsafe" } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.workspaces).toEqual([workspaceA]);
    });
  });

  describe("fileReconciliation scalar override", () => {
    it("local mode overrides project", () => {
      const project = makeProject({ fileReconciliation: { mode: "report_only" } });
      const localUser = makeOverlay({ fileReconciliation: { mode: "warn" } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.fileReconciliation?.mode).toBe("warn");
    });
  });

  describe("publish: per-scalar override", () => {
    it("local publish fields override project", () => {
      const project = makeProject({
        publish: { auto: true, remote: "origin", provider: "github" },
      });
      const localUser = makeOverlay({
        publish: { auto: false, remote: "my-fork" },
      });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.publish?.auto).toBe(false);
      expect(result.publish?.remote).toBe("my-fork");
      expect(result.publish?.provider).toBe("github");
    });

    it("auto: false in user layer correctly overrides auto: true in project", () => {
      const project = makeProject({ publish: { auto: true } });
      const localUser = makeOverlay({ publish: { auto: false } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.publish?.auto).toBe(false);
    });
  });

  describe("orient: scalar override", () => {
    it("keeps the project orient block when a user layer says nothing about orient", () => {
      const project = makeProject({ orient: { command: "orient-provider" } });
      const localUser = makeOverlay({ state: { root: "~/.local" } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.orient?.command).toBe("orient-provider");
    });

    it("local orient command overrides global and project", () => {
      const project = makeProject({ orient: { command: "project-provider" } });
      const globalUser = makeOverlay({ orient: { command: "global-provider" } });
      const localUser = makeOverlay({ orient: { command: "local-provider" } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.orient?.command).toBe("local-provider");
    });

    it("a user layer can enable orient when the project config has none", () => {
      const project = makeProject();
      const globalUser = makeOverlay({ orient: { command: "global-provider" } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.orient?.command).toBe("global-provider");
    });

    it("omits orient entirely when no layer configures it", () => {
      const result = mergeConfigLayers({
        project: makeProject(),
        localUser: makeOverlay({ state: { root: "~/.local" } }),
      });
      expect(result.orient).toBeUndefined();
    });
  });

  describe("scopes: scalar override", () => {
    it("keeps the project scopes block when a user layer says nothing about scopes", () => {
      const project = makeProject({ scopes: { command: "scopes-provider" } });
      const localUser = makeOverlay({ state: { root: "~/.local" } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.scopes?.command).toBe("scopes-provider");
    });

    it("local scopes command overrides global and project", () => {
      const project = makeProject({ scopes: { command: "project-provider" } });
      const globalUser = makeOverlay({ scopes: { command: "global-provider" } });
      const localUser = makeOverlay({ scopes: { command: "local-provider" } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.scopes?.command).toBe("local-provider");
    });

    it("a user layer can enable scopes when the project config has none", () => {
      const project = makeProject();
      const globalUser = makeOverlay({ scopes: { command: "global-provider" } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.scopes?.command).toBe("global-provider");
    });

    it("omits scopes entirely when no layer configures it", () => {
      const result = mergeConfigLayers({
        project: makeProject(),
        localUser: makeOverlay({ state: { root: "~/.local" } }),
      });
      expect(result.scopes).toBeUndefined();
    });
  });

  describe("planAuditor: scalar override", () => {
    it("keeps the project planAuditor block when a user layer says nothing about planAuditor", () => {
      const project = makeProject({ planAuditor: { command: "audit-plan" } });
      const localUser = makeOverlay({ state: { root: "~/.local" } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.planAuditor?.command).toBe("audit-plan");
    });

    it("local planAuditor command overrides global and project", () => {
      const project = makeProject({ planAuditor: { command: "project-provider" } });
      const globalUser = makeOverlay({ planAuditor: { command: "global-provider" } });
      const localUser = makeOverlay({ planAuditor: { command: "local-provider" } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.planAuditor?.command).toBe("local-provider");
    });

    it("a user layer can enable planAuditor when the project config has none", () => {
      const project = makeProject();
      const globalUser = makeOverlay({ planAuditor: { command: "global-provider" } });
      const result = mergeConfigLayers({ project, globalUser });
      expect(result.planAuditor?.command).toBe("global-provider");
    });

    it("omits planAuditor entirely when no layer configures it", () => {
      const result = mergeConfigLayers({
        project: makeProject(),
        localUser: makeOverlay({ state: { root: "~/.local" } }),
      });
      expect(result.planAuditor).toBeUndefined();
    });
  });

  describe("review.compliance: per-scalar override", () => {
    it("local compliance fields override project", () => {
      const project = makeProject({
        review: { compliance: { enabled: false, model: "base-model", effort: "low" } },
      });
      const localUser = makeOverlay({
        review: { compliance: { enabled: true, effort: "high" } },
      });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.review?.compliance?.enabled).toBe(true);
      expect(result.review?.compliance?.model).toBe("base-model");
      expect(result.review?.compliance?.effort).toBe("high");
    });
  });

  describe("review.code: per-scalar override", () => {
    it("project code review survives an overlay that does not set it", () => {
      const project = makeProject({
        review: {
          compliance: { enabled: true },
          code: { model: "claude-sonnet-5", effort: "medium" },
        },
      });
      const result = mergeConfigLayers({ project, globalUser: makeOverlay() });
      expect(result.review?.code).toEqual({ model: "claude-sonnet-5", effort: "medium" });
      expect(result.review?.compliance?.enabled).toBe(true);
    });

    it("local beats global beats project, per field", () => {
      const project = makeProject({ review: { code: { model: "base-model", effort: "low" } } });
      const globalUser = makeOverlay({ review: { code: { effort: "medium" } } });
      const localUser = makeOverlay({ review: { code: { effort: "high" } } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.review?.code).toEqual({ model: "base-model", effort: "high" });
      expect(result.review?.compliance).toBeUndefined();
    });
  });

  describe("authoring: per-kind, per-scalar override", () => {
    it("project authoring survives an empty overlay", () => {
      const project = makeProject({
        authoring: { spec: { model: "claude-sonnet-5" }, plan: { effort: "high" } },
      });
      const result = mergeConfigLayers({ project, globalUser: makeOverlay() });
      expect(result.authoring).toEqual({
        spec: { model: "claude-sonnet-5" },
        plan: { effort: "high" },
      });
    });

    it("overlay fields override per kind and per field, local beating global", () => {
      const project = makeProject({
        authoring: { spec: { model: "base-model", effort: "low" } },
      });
      const globalUser = makeOverlay({
        authoring: { spec: { effort: "medium" }, plan: { model: "global-model" } },
      });
      const localUser = makeOverlay({ authoring: { spec: { effort: "high" } } });
      const result = mergeConfigLayers({ project, globalUser, localUser });
      expect(result.authoring).toEqual({
        spec: { model: "base-model", effort: "high" },
        plan: { model: "global-model" },
      });
    });

    it("authoring is absent when no layer sets it", () => {
      const result = mergeConfigLayers({
        project: makeProject(),
        localUser: makeOverlay({ state: { root: "~/.local" } }),
      });
      expect(result.authoring).toBeUndefined();
    });
  });

  describe("identity fields always from project", () => {
    it("version and name always come from the project config", () => {
      const project = makeProject({ name: "my-project" });
      const localUser = makeOverlay({ state: { root: "~/.local" } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.version).toBe(1);
      expect(result.name).toBe("my-project");
    });
  });

  describe("network.profile scalar override", () => {
    it("local network profile overrides project", () => {
      const project = makeProject({ security: { network: { profile: "provider-only" } } });
      const localUser = makeOverlay({ security: { network: { profile: "open" } } });
      const result = mergeConfigLayers({ project, localUser });
      expect(result.security?.network?.profile).toBe("open");
    });
  });
});
