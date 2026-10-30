import { describe, expect, it } from "vitest";
import { phaseCoverageRefusal } from "../../../src/domain/review/compliancePhaseCoverage.js";
import {
  renderComplianceReviewMarkdown,
  type ComplianceReviewToRender,
} from "../../../src/domain/review/complianceMarkdown.js";

const base: ComplianceReviewToRender = {
  verdict: "conformant",
  summary: "Fine.",
  perPhase: [],
  unplannedChanges: [],
  unmetPromises: [],
  attentionPoints: [],
  pointers: [],
};

describe("renderComplianceReviewMarkdown edges", () => {
  it("keeps a multi-line finding message verbatim inside its item", () => {
    const md = renderComplianceReviewMarkdown("run-1", {
      ...base,
      perPhase: [
        {
          phaseId: "phase-01",
          verdict: "partial",
          findings: [{ dimension: "scope", severity: "high", message: "line one\nline two" }],
        },
      ],
    });
    expect(md).toContain("## phase-01 — partial\n\n- scope · high — line one\nline two\n");
  });

  it("renders None. for a whitespace-only summary", () => {
    const md = renderComplianceReviewMarkdown("run-1", { ...base, summary: " \n\t " });
    expect(md.startsWith("# Compliance review — run-1\n\nVerdict: conformant\n\nNone.\n")).toBe(
      true,
    );
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});

describe("phaseCoverageRefusal edges", () => {
  it("reports a phase named three times once", () => {
    expect(phaseCoverageRefusal(["phase-01", "phase-01", "phase-01"], ["phase-01"])).toBe(
      'perPhase: phase "phase-01" is named more than once',
    );
  });
});
