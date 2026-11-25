import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { resolveGateProfile } from "../../src/app/gates.js";
import {
  resolveGateProfileById,
  undefinedGateProfileMessage,
} from "../../src/domain/gate/gateProfile.js";
import {
  decodePhaxConfig,
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type GateStep,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { resolveRecordsConfig } from "../../src/schemas/recordsConfig.js";

function step(command: string, surface: GateStep["surface"] = "local"): GateStep {
  return { command, surface, firing: "every-phase", output: "log" };
}

function makeConfig(overrides?: Partial<ResolvedConfig["raw"]>): ResolvedConfig {
  const raw: ResolvedConfig["raw"] = {
    version: 1,
    name: "test-project",
    state: { root: "~/.phax" },
    gateProfiles: {
      fast: [step("pnpm test")],
      full: [step("pnpm test"), step("pnpm lint")],
    },
    ...overrides,
  };
  return {
    raw,
    namespace: "test-project",
    stateRoot: "/home/user/.phax",
    repoRoot: "/home/user/repo",
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
    records: resolveRecordsConfig(undefined),

    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
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
      'gate profile "nonexistent" is not defined in phax.json (defined: fast, full)',
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

type Profiles = Record<string, readonly GateStep[]>;
type Row = {
  readonly name: string;
  readonly topLevel: Profiles;
  readonly workspace: Profiles | undefined;
  readonly workspaceId: string | undefined;
  readonly expected: readonly { readonly id: string; readonly steps: readonly GateStep[] }[];
};

// The schema refuses an empty profile, but the rule must still treat one as undefined.
function gateConfig(topLevel: Profiles, workspace: Profiles | undefined) {
  return {
    gateProfiles: topLevel,
    workspaces: [{ id: "ws", ...(workspace === undefined ? {} : { gateProfiles: workspace }) }],
  };
}

const A = step("a");
const B = step("b");
const W = step("w");

const ROWS: readonly Row[] = [
  {
    name: "top-level entries in phax.json order",
    topLevel: { light: [A], standard: [B] },
    workspace: undefined,
    workspaceId: undefined,
    expected: [
      { id: "light", steps: [A] },
      { id: "standard", steps: [B] },
    ],
  },
  {
    name: "an empty top-level entry is not defined",
    topLevel: { empty: [], standard: [B] },
    workspace: undefined,
    workspaceId: undefined,
    expected: [{ id: "standard", steps: [B] }],
  },
  {
    name: "a non-empty workspace entry replaces the top-level one, keeping its position",
    topLevel: { light: [A], standard: [B] },
    workspace: { light: [W] },
    workspaceId: "ws",
    expected: [
      { id: "light", steps: [W] },
      { id: "standard", steps: [B] },
    ],
  },
  {
    name: "an empty workspace entry leaves the top-level one",
    topLevel: { light: [A] },
    workspace: { light: [] },
    workspaceId: "ws",
    expected: [{ id: "light", steps: [A] }],
  },
  {
    name: "a non-empty workspace entry defines an empty top-level id",
    topLevel: { light: [], standard: [B] },
    workspace: { light: [W] },
    workspaceId: "ws",
    expected: [
      { id: "light", steps: [W] },
      { id: "standard", steps: [B] },
    ],
  },
  {
    name: "workspace-only ids come last; an empty one is not defined",
    topLevel: { standard: [B] },
    workspace: { extra: [W], none: [] },
    workspaceId: "ws",
    expected: [
      { id: "standard", steps: [B] },
      { id: "extra", steps: [W] },
    ],
  },
  {
    name: "the workspace layer is ignored without a workspace id",
    topLevel: { standard: [B] },
    workspace: { extra: [W], standard: [W] },
    workspaceId: undefined,
    expected: [{ id: "standard", steps: [B] }],
  },
  {
    name: "the workspace layer is ignored for an unknown workspace id",
    topLevel: { standard: [B] },
    workspace: { extra: [W] },
    workspaceId: "other",
    expected: [{ id: "standard", steps: [B] }],
  },
  {
    name: "nothing defined",
    topLevel: { empty: [] },
    workspace: undefined,
    workspaceId: undefined,
    expected: [],
  },
];

describe("resolveGateProfileById", () => {
  // The refusal lists the defined ids in the rule's order.
  it.each(ROWS)("defines exactly the expected ids, in order: $name", (row) => {
    const config = gateConfig(row.topLevel, row.workspace);
    expect(resolveGateProfileById(config, "no-such-profile", row.workspaceId)).toEqual(
      Result.fail({ id: "no-such-profile", defined: row.expected.map((p) => p.id) }),
    );
  });

  it.each(ROWS)("resolves every defined id to its steps: $name", (row) => {
    const config = gateConfig(row.topLevel, row.workspace);
    for (const { id, steps } of row.expected) {
      expect(resolveGateProfileById(config, id, row.workspaceId)).toEqual(Result.succeed(steps));
    }
  });

  it("refuses an undefined id, naming it and every defined id", () => {
    const config = gateConfig({ light: [A], standard: [B] }, { extra: [W] });
    expect(resolveGateProfileById(config, "heavy", "ws")).toEqual(
      Result.fail({ id: "heavy", defined: ["light", "standard", "extra"] }),
    );
  });

  it("refuses an id whose only entry is empty", () => {
    const config = gateConfig({ empty: [], standard: [B] }, undefined);
    expect(resolveGateProfileById(config, "empty", undefined)).toEqual(
      Result.fail({ id: "empty", defined: ["standard"] }),
    );
  });
});

describe("undefinedGateProfileMessage", () => {
  it.each([
    [[], 'gate profile "light" is not defined in phax.json (defined: none)'],
    [["standard"], 'gate profile "light" is not defined in phax.json (defined: standard)'],
    [
      ["standard", "full", "extra"],
      'gate profile "light" is not defined in phax.json (defined: standard, full, extra)',
    ],
  ] as const)("defined %j", (defined, expected) => {
    expect(undefinedGateProfileMessage({ id: "light", defined })).toBe(expected);
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
    expect(Result.isSuccess(decoded)).toBe(true);
  });

  it("rejects the old flat-array (command-string) profile form, naming the profile", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: ["pnpm test", "pnpm lint"],
      },
    });
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      const message = decoded.failure.toString();
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
    expect(Result.isFailure(decoded)).toBe(true);
  });

  it("rejects a step whose firing is outside the closed enum", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [{ command: "pnpm test", surface: "local", firing: "sometimes" }],
      },
    });
    expect(Result.isFailure(decoded)).toBe(true);
  });

  it("rejects an unknown step key (onExcessProperty: error)", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [{ command: "pnpm test", surface: "local", firing: "every-phase", extra: true }],
      },
    });
    expect(Result.isFailure(decoded)).toBe(true);
  });

  it("decodes a step without output to output: log", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
      },
    });
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success.gateProfiles["full"]?.[0]?.output).toBe("log");
    }
  });

  it("decodes a step with output: gate-report and no input", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [
          {
            command: "node ./audit.mjs",
            surface: "local",
            firing: "every-phase",
            output: "gate-report",
          },
        ],
      },
    });
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success.gateProfiles["full"]?.[0]?.output).toBe("gate-report");
      expect(decoded.success.gateProfiles["full"]?.[0]?.input).toBeUndefined();
    }
  });

  it("rejects a step with output: diagnostics", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [
          {
            command: "node ./audit.mjs",
            surface: "local",
            firing: "every-phase",
            output: "diagnostics",
          },
        ],
      },
    });
    expect(Result.isFailure(decoded)).toBe(true);
  });

  it("rejects a step whose output is outside the closed enum", () => {
    const decoded = decodePhaxConfig({
      ...baseConfig,
      gateProfiles: {
        full: [{ command: "pnpm test", surface: "local", firing: "every-phase", output: "json" }],
      },
    });
    expect(Result.isFailure(decoded)).toBe(true);
  });
});
