import { describe, it, expect } from "vitest";
import {
  structureFindings,
  plannedPaths,
  filePlanFindings,
  commandFindings,
  modelFindings,
  hasLintErrors,
  type LintCheck,
  type LintSeverity,
  type FilePlanPhase,
} from "../../src/domain/plan/lint.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";

// Conforming plan: extractPlanDeterministic parses this without the LLM.
// Reused verbatim from tests/unit/loadOrExtractPlan.test.ts.
const CONFORMING_PLAN = `# Test Plan

## Required commands

- (none)

## phase-01 — First Phase {#phase-01-first}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Commit subject

feat(test): do thing

### Commit body

Does the thing.

---
`;

describe("structureFindings", () => {
  it("returns [] for a conforming plan", () => {
    expect(structureFindings(CONFORMING_PLAN)).toEqual([]);
  });

  it("maps every structural error to an error finding on the structure check", () => {
    const nonConforming = CONFORMING_PLAN.replace("## Required commands\n\n- (none)\n\n", "");

    const findings = structureFindings(nonConforming);

    expect(findings).toEqual([
      {
        severity: "error",
        check: "structure",
        phase: null,
        message: `missing "## Required commands" section`,
      },
    ]);
  });

  it("only produces findings within the closed severity and check vocabulary", () => {
    const severities: readonly LintSeverity[] = ["error", "warning"];
    const checks: readonly LintCheck[] = ["structure", "files", "commands", "models"];
    for (const finding of structureFindings(CONFORMING_PLAN.replace("- (none)\n\n", ""))) {
      expect(severities).toContain(finding.severity);
      expect(checks).toContain(finding.check);
    }
  });
});

function phase(overrides: Partial<FilePlanPhase> & { id: string }): FilePlanPhase {
  return {
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    ...overrides,
  };
}

describe("plannedPaths", () => {
  it("deduplicates and excludes optional files, in plan order", () => {
    const phases: readonly FilePlanPhase[] = [
      phase({
        id: "phase-01",
        plannedFilesToCreate: ["a.ts"],
        plannedFilesToEdit: ["b.ts"],
        optionalFilesToEdit: ["z.ts"],
      }),
      phase({
        id: "phase-02",
        plannedFilesToCreate: ["a.ts", "c.ts"],
        plannedFilesToEdit: [],
      }),
    ];

    expect(plannedPaths(phases)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});

describe("filePlanFindings", () => {
  it("returns [] for a clean multi-phase plan", () => {
    const phases: readonly FilePlanPhase[] = [
      phase({ id: "phase-01", plannedFilesToCreate: ["a.ts"] }),
      phase({ id: "phase-02", plannedFilesToEdit: ["a.ts"], plannedFilesToCreate: ["b.ts"] }),
    ];

    expect(filePlanFindings(phases, new Set())).toEqual([]);
  });

  it("flags editing a file that does not exist and no earlier phase creates", () => {
    const phases: readonly FilePlanPhase[] = [
      phase({ id: "phase-01", plannedFilesToEdit: ["missing.ts"] }),
    ];

    expect(filePlanFindings(phases, new Set())).toEqual([
      {
        severity: "error",
        check: "files",
        phase: "phase-01",
        message: "edit missing.ts: does not exist and no earlier phase creates it",
      },
    ]);
  });

  it("allows editing a file created by an earlier phase", () => {
    const phases: readonly FilePlanPhase[] = [
      phase({ id: "phase-01", plannedFilesToCreate: ["a.ts"] }),
      phase({ id: "phase-02", plannedFilesToEdit: ["a.ts"] }),
    ];

    expect(filePlanFindings(phases, new Set())).toEqual([]);
  });

  it("flags creating a file that already exists in the working tree", () => {
    const phases: readonly FilePlanPhase[] = [
      phase({ id: "phase-01", plannedFilesToCreate: ["existing.ts"] }),
    ];

    expect(filePlanFindings(phases, new Set(["existing.ts"]))).toEqual([
      {
        severity: "error",
        check: "files",
        phase: "phase-01",
        message: "create existing.ts: exists in the working tree",
      },
    ]);
  });

  it("flags creating a file an earlier phase already created", () => {
    const phases: readonly FilePlanPhase[] = [
      phase({ id: "phase-01", plannedFilesToCreate: ["a.ts"] }),
      phase({ id: "phase-02", plannedFilesToCreate: ["a.ts"] }),
    ];

    expect(filePlanFindings(phases, new Set())).toEqual([
      {
        severity: "error",
        check: "files",
        phase: "phase-02",
        message: "create a.ts: already created by phase-01",
      },
    ]);
  });

  it("flags a phase that both creates and edits the same path", () => {
    const phases: readonly FilePlanPhase[] = [
      phase({ id: "phase-01", plannedFilesToCreate: ["a.ts"], plannedFilesToEdit: ["a.ts"] }),
    ];

    expect(filePlanFindings(phases, new Set())).toEqual([
      {
        severity: "error",
        check: "files",
        phase: "phase-01",
        message: "create and edit both list a.ts",
      },
    ]);
  });

  it("never checks optional files, existing or absent", () => {
    const phases: readonly FilePlanPhase[] = [
      phase({ id: "phase-01", optionalFilesToEdit: ["existing.ts", "absent.ts"] }),
    ];

    expect(filePlanFindings(phases, new Set(["existing.ts"]))).toEqual([]);
  });

  it("warns when a path is listed both to create and as optional in the same phase", () => {
    const phases: readonly FilePlanPhase[] = [
      phase({ id: "phase-01", plannedFilesToCreate: ["a.ts"], optionalFilesToEdit: ["a.ts"] }),
    ];

    expect(filePlanFindings(phases, new Set())).toEqual([
      {
        severity: "warning",
        check: "files",
        phase: "phase-01",
        message: "create a.ts: also listed under optional files",
      },
    ]);
  });
});

describe("commandFindings", () => {
  it("returns no findings when every required command is covered", () => {
    expect(commandFindings(["pnpm test", "deno fmt"], ["deno"], ["pnpm test"])).toEqual([]);
  });

  it("reports one error per uncovered required command", () => {
    expect(commandFindings(["deno", "cargo"], ["pnpm"], ["pnpm test"])).toEqual([
      {
        severity: "error",
        check: "commands",
        phase: null,
        message:
          'required command "deno" is not covered by security.agentCommands or the gate profile',
      },
      {
        severity: "error",
        check: "commands",
        phase: null,
        message:
          'required command "cargo" is not covered by security.agentCommands or the gate profile',
      },
    ]);
  });
});

describe("modelFindings", () => {
  it("returns no findings for a phase whose model and effort are in the catalog", () => {
    expect(
      modelFindings(
        [{ id: "phase-01", model: "claude-sonnet-5", effort: "medium" }],
        DEFAULT_MODEL_ROUTING,
        DEFAULT_PROVIDER_CONFIG,
      ),
    ).toEqual([]);
  });

  it("reports an unknown model id against the failing phase", () => {
    expect(
      modelFindings(
        [{ id: "phase-02", model: "claude-imaginary-9", effort: "medium" }],
        DEFAULT_MODEL_ROUTING,
        DEFAULT_PROVIDER_CONFIG,
      ),
    ).toEqual([
      {
        severity: "error",
        check: "models",
        phase: "phase-02",
        message: 'claude-imaginary-9 / medium: model id "claude-imaginary-9" not found in catalog',
      },
    ]);
  });

  it("appends the catalog alternatives when the failure lists any", () => {
    const findings = modelFindings(
      [{ id: "phase-01", model: "claude-sonnet-5", effort: "none" }],
      DEFAULT_MODEL_ROUTING,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.check).toBe("models");
    expect(findings[0]?.phase).toBe("phase-01");
    expect(findings[0]?.message).toContain(
      'claude-sonnet-5 / none: effort "none" is not supported',
    );
    expect(findings[0]?.message).toContain("(alternatives: claude-sonnet-5)");
  });
});

describe("hasLintErrors", () => {
  it("is false for no findings and for warnings only", () => {
    expect(hasLintErrors([])).toBe(false);
    expect(
      hasLintErrors([{ severity: "warning", check: "files", phase: "phase-01", message: "w" }]),
    ).toBe(false);
  });

  it("is true as soon as one finding is an error", () => {
    expect(
      hasLintErrors([
        { severity: "warning", check: "files", phase: "phase-01", message: "w" },
        { severity: "error", check: "models", phase: "phase-02", message: "e" },
      ]),
    ).toBe(true);
  });
});
