import { describe, it, expect } from "vitest";
import {
  structureFindings,
  type LintCheck,
  type LintSeverity,
} from "../../src/domain/plan/lint.js";

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
