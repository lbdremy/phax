import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodePhaxConfig } from "../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../src/schemas/phaxPlan.js";
import { decodeRegistry } from "../../src/schemas/registry.js";
import { decodePhaseStatus, decodeRunStatus } from "../../src/schemas/status.js";

const validConfig = {
  version: 1,
  name: "my-project",
  state: { root: "~/.phax" },
  gateProfiles: { fast: ["pnpm test"] },
} as const;

describe("decodePhaxConfig", () => {
  it("accepts a minimal valid config", () => {
    expect(Either.isRight(decodePhaxConfig(validConfig))).toBe(true);
  });

  it("accepts a full config with all optional fields", () => {
    const full = {
      ...validConfig,
      agent: { maxFixAttempts: 1 },
      commands: { setup: ["pnpm install"], cleanup: ["rm -rf node_modules"] },
      gateProfiles: { fast: ["pnpm test"], full: ["pnpm test", "pnpm lint"] },
      workspaces: [{ id: "frontend", name: "Frontend", path: "./packages/ui" }],
    };
    expect(Either.isRight(decodePhaxConfig(full))).toBe(true);
  });

  it("rejects a config with version != 1", () => {
    expect(Either.isLeft(decodePhaxConfig({ ...validConfig, version: 2 }))).toBe(true);
  });

  it("rejects a config with an empty gate profile command array", () => {
    const bad = { ...validConfig, gateProfiles: { fast: [] } };
    expect(Either.isLeft(decodePhaxConfig(bad))).toBe(true);
  });

  it("rejects a config with excess properties", () => {
    expect(Either.isLeft(decodePhaxConfig({ ...validConfig, unknown: "field" }))).toBe(true);
  });

  it("rejects a config missing the required name field", () => {
    const { name: _, ...noName } = validConfig;
    expect(Either.isLeft(decodePhaxConfig(noName))).toBe(true);
  });

  it("rejects a config with a leftover project struct as an excess property", () => {
    const bad = { ...validConfig, project: { name: "x", type: "single-package" } };
    expect(Either.isLeft(decodePhaxConfig(bad))).toBe(true);
  });

  it("rejects a config with maxFixAttempts out of range", () => {
    const bad = {
      ...validConfig,
      agent: { maxFixAttempts: 11 },
    };
    expect(Either.isLeft(decodePhaxConfig(bad))).toBe(true);
  });

  it("accepts agent.extractPlan with model and effort", () => {
    const cfg = {
      ...validConfig,
      agent: {
        extractPlan: { model: "claude-haiku-4-5-20251001", effort: "low" },
      },
    };
    expect(Either.isRight(decodePhaxConfig(cfg))).toBe(true);
  });

  it("accepts agent.extractPlan with only model", () => {
    const cfg = {
      ...validConfig,
      agent: { extractPlan: { model: "claude-sonnet-4-6" } },
    };
    expect(Either.isRight(decodePhaxConfig(cfg))).toBe(true);
  });

  it("accepts agent.extractPlan with only effort", () => {
    const cfg = {
      ...validConfig,
      agent: { extractPlan: { effort: "medium" } },
    };
    expect(Either.isRight(decodePhaxConfig(cfg))).toBe(true);
  });

  it("accepts agent.extractPlan as an empty object", () => {
    const cfg = {
      ...validConfig,
      agent: { extractPlan: {} },
    };
    expect(Either.isRight(decodePhaxConfig(cfg))).toBe(true);
  });

  it("rejects agent.extractPlan with invalid effort", () => {
    const cfg = {
      ...validConfig,
      agent: { extractPlan: { effort: "extreme" } },
    };
    expect(Either.isLeft(decodePhaxConfig(cfg))).toBe(true);
  });

  it("rejects agent.extractPlan with excess properties", () => {
    const cfg = {
      ...validConfig,
      agent: { extractPlan: { unknown: "field" } },
    };
    expect(Either.isLeft(decodePhaxConfig(cfg))).toBe(true);
  });

  it("accepts fileReconciliation with mode report_only", () => {
    const cfg = { ...validConfig, fileReconciliation: { mode: "report_only" } };
    expect(Either.isRight(decodePhaxConfig(cfg))).toBe(true);
  });

  it("accepts fileReconciliation with mode warn", () => {
    const cfg = { ...validConfig, fileReconciliation: { mode: "warn" } };
    expect(Either.isRight(decodePhaxConfig(cfg))).toBe(true);
  });

  it("rejects fileReconciliation with an unknown mode", () => {
    const cfg = { ...validConfig, fileReconciliation: { mode: "fail_on_missing" } };
    expect(Either.isLeft(decodePhaxConfig(cfg))).toBe(true);
  });

  it("rejects fileReconciliation with excess properties", () => {
    const cfg = { ...validConfig, fileReconciliation: { mode: "warn", extra: true } };
    expect(Either.isLeft(decodePhaxConfig(cfg))).toBe(true);
  });

  it("accepts a config with no fileReconciliation field", () => {
    expect(Either.isRight(decodePhaxConfig(validConfig))).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(Either.isLeft(decodePhaxConfig("not-an-object"))).toBe(true);
    expect(Either.isLeft(decodePhaxConfig(null))).toBe(true);
    expect(Either.isLeft(decodePhaxConfig(42))).toBe(true);
  });
});

const validPlan = {
  version: 1,
  run: {
    shortName: "my-run",
    title: "My Run",
    branch: "feature/my-run",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "First Phase",
      model: "claude-sonnet-4-6",
      effort: "low",
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
  ],
} as const;

describe("decodePhaxPlan", () => {
  it("accepts a valid plan", () => {
    expect(Either.isRight(decodePhaxPlan(validPlan))).toBe(true);
  });

  it("rejects a plan with no phases", () => {
    const bad = { ...validPlan, phases: [] };
    expect(Either.isLeft(decodePhaxPlan(bad))).toBe(true);
  });

  it("rejects a phase with invalid effort", () => {
    const bad = {
      ...validPlan,
      phases: [{ ...validPlan.phases[0]!, effort: "extreme" }],
    };
    expect(Either.isLeft(decodePhaxPlan(bad))).toBe(true);
  });

  it("rejects a plan missing a required field", () => {
    const { run: _, ...noRun } = validPlan;
    expect(Either.isLeft(decodePhaxPlan(noRun))).toBe(true);
  });

  it("rejects excess properties", () => {
    const bad = { ...validPlan, extra: "field" };
    expect(Either.isLeft(decodePhaxPlan(bad))).toBe(true);
  });

  it("rejects a phase missing plannedFilesToCreate", () => {
    const { plannedFilesToCreate: _, ...noCreate } = validPlan.phases[0];
    const bad = { ...validPlan, phases: [noCreate] };
    expect(Either.isLeft(decodePhaxPlan(bad))).toBe(true);
  });

  it("rejects a phase missing plannedFilesToEdit", () => {
    const { plannedFilesToEdit: _, ...noEdit } = validPlan.phases[0];
    const bad = { ...validPlan, phases: [noEdit] };
    expect(Either.isLeft(decodePhaxPlan(bad))).toBe(true);
  });

  it("rejects a phase missing optionalFilesToEdit", () => {
    const { optionalFilesToEdit: _, ...noOptional } = validPlan.phases[0];
    const bad = { ...validPlan, phases: [noOptional] };
    expect(Either.isLeft(decodePhaxPlan(bad))).toBe(true);
  });

  it("accepts a phase with empty planned-file arrays", () => {
    expect(Either.isRight(decodePhaxPlan(validPlan))).toBe(true);
  });

  it("accepts a phase with populated planned-file arrays and round-trips", () => {
    const withFiles = {
      ...validPlan,
      phases: [
        {
          ...validPlan.phases[0],
          plannedFilesToCreate: ["src/new.ts"],
          plannedFilesToEdit: ["src/existing.ts"],
          optionalFilesToEdit: ["docs/readme.md"],
        },
      ],
    };
    const decoded = decodePhaxPlan(withFiles);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isLeft(decoded)) throw new Error("unexpected Left");
    expect(decoded.right.phases[0]!.plannedFilesToCreate).toEqual(["src/new.ts"]);
    expect(decoded.right.phases[0]!.plannedFilesToEdit).toEqual(["src/existing.ts"]);
    expect(decoded.right.phases[0]!.optionalFilesToEdit).toEqual(["docs/readme.md"]);
  });
});

const now = new Date().toISOString();

describe("decodeRunStatus", () => {
  const validRunStatus = {
    version: 1,
    namespace: "my-project",
    shortName: "my-run",
    runId: "my-run-123",
    state: "created",
    createdAt: now,
    updatedAt: now,
    phasesCount: 3,
  };

  it("accepts a valid run status", () => {
    expect(Either.isRight(decodeRunStatus(validRunStatus))).toBe(true);
  });

  it("rejects a run status missing namespace", () => {
    const { namespace: _, ...noNamespace } = validRunStatus;
    expect(Either.isLeft(decodeRunStatus(noNamespace))).toBe(true);
  });

  it("accepts an optional gateProfileId", () => {
    expect(Either.isRight(decodeRunStatus({ ...validRunStatus, gateProfileId: "fast" }))).toBe(
      true,
    );
  });

  it("rejects an invalid state", () => {
    const bad = { ...validRunStatus, state: "invalid-state" };
    expect(Either.isLeft(decodeRunStatus(bad))).toBe(true);
  });

  it("rejects missing required fields", () => {
    const { shortName: _, ...noShortName } = validRunStatus;
    expect(Either.isLeft(decodeRunStatus(noShortName))).toBe(true);
  });
});

describe("decodePhaseStatus", () => {
  const validPhaseStatus = {
    version: 1,
    phaseId: "phase-01",
    phaseIndex: 0,
    state: "pending",
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: "ai/my-run--phase-01",
    createdAt: now,
    updatedAt: now,
  };

  it("accepts a valid phase status", () => {
    expect(Either.isRight(decodePhaseStatus(validPhaseStatus))).toBe(true);
  });

  it("accepts optional worktreePath and claudeSessionId", () => {
    const withOptionals = {
      ...validPhaseStatus,
      worktreePath: "/path/to/worktree",
      claudeSessionId: "sess-abc",
      commitHash: "abc123",
    };
    expect(Either.isRight(decodePhaseStatus(withOptionals))).toBe(true);
  });

  it("rejects an invalid phase state", () => {
    const bad = { ...validPhaseStatus, state: "not-a-state" };
    expect(Either.isLeft(decodePhaseStatus(bad))).toBe(true);
  });

  it("rejects an invalid effort", () => {
    const bad = { ...validPhaseStatus, effort: "extreme" };
    expect(Either.isLeft(decodePhaseStatus(bad))).toBe(true);
  });
});

describe("decodeRegistry", () => {
  const validEntry = {
    namespace: "my-project",
    shortName: "my-run",
    runId: "my-run-123",
    state: "created",
    branch: "phax/my-run",
    projectName: "my-project",
    phasesCount: 1,
    createdAt: now,
    updatedAt: now,
  };

  it("accepts a valid registry with namespace on each entry", () => {
    const registry = { version: 1, runs: [validEntry] };
    expect(Either.isRight(decodeRegistry(registry))).toBe(true);
  });

  it("rejects a registry entry missing namespace", () => {
    const { namespace: _, ...noNamespace } = validEntry;
    const registry = { version: 1, runs: [noNamespace] };
    expect(Either.isLeft(decodeRegistry(registry))).toBe(true);
  });
});
