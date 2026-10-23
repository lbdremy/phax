import { describe, expect, it } from "vitest";
import {
  renderReviewCorrectionsSection,
  type ReviewCorrectionStop,
} from "../../../src/domain/interactive/reviewCorrections.js";

const handoff = (n: string): string => `## What was corrected
- Fix ${n}.

## The pattern to follow from now on
- Pattern ${n}.

## Guards
- tests/a.test.ts › ${n}

## What the next phases need to know
- Know ${n}.
`;

const declared = (
  phaseId: string,
  n: string,
  changedFiles: readonly string[] = [],
): ReviewCorrectionStop => ({ phaseId, cause: "declared", handoff: handoff(n), changedFiles });

describe("renderReviewCorrectionsSection", () => {
  it("is null when no stop has closed", () => {
    expect(renderReviewCorrectionsSection([])).toBeNull();
  });

  it("holds one stop with its handoff verbatim and its changed files", () => {
    const section = renderReviewCorrectionsSection([
      declared("phase-03", "a", ["src/export/invoiceRow.ts"]),
    ]);
    expect(section).toContain("## Review corrections");
    expect(section).toContain("reviewed and corrected the run at phase-03.");
    expect(section).toContain("### phase-03 (interactive)");
    expect(section).toContain(handoff("a").trimEnd());
    expect(section).toContain("Files changed by the review:\n- src/export/invoiceRow.ts");
  });

  it("keeps plan order across two stops and names both", () => {
    const section = renderReviewCorrectionsSection([
      declared("phase-03", "a"),
      declared("phase-05", "b", ["x.ts"]),
    ]);
    expect(section).toContain("at phase-03 and phase-05.");
    expect(section?.indexOf("### phase-03 (interactive)")).toBeLessThan(
      section?.indexOf("### phase-05 (interactive)") ?? -1,
    );
    expect(section).toContain("No file changed.");
  });

  it("headings a held stop (held) and a declared one (interactive), in plan order", () => {
    const section = renderReviewCorrectionsSection([
      { phaseId: "phase-02", cause: "held", handoff: handoff("a"), changedFiles: ["src/a.ts"] },
      declared("phase-03", "b"),
    ]);
    expect(section).toContain("at phase-02 and phase-03.");
    expect(section).toContain("### phase-02 (held)");
    expect(section).toContain("### phase-03 (interactive)");
    expect(section).not.toContain("### phase-02 (interactive)");
    expect(section?.indexOf("### phase-02 (held)")).toBeLessThan(
      section?.indexOf("### phase-03 (interactive)") ?? -1,
    );
  });

  it("says the section wins and the phase's own plan section still binds", () => {
    const section = renderReviewCorrectionsSection([declared("phase-03", "a")]);
    expect(section).toContain(
      "Where this section disagrees with an earlier phase's handoff, this section wins.",
    );
    expect(section).toContain("Your own plan section still binds.");
  });

  it("joins three stops with commas and an and", () => {
    const section = renderReviewCorrectionsSection(
      ["phase-02", "phase-03", "phase-05"].map((phaseId) => ({
        phaseId,
        cause: "held" as const,
        handoff: "h",
        changedFiles: [],
      })),
    );
    expect(section).toContain("at phase-02, phase-03 and phase-05.");
  });
});
