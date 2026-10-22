import { describe, expect, it } from "vitest";
import { renderReviewCorrectionsSection } from "../../../src/domain/interactive/reviewCorrections.js";

const handoff = (n: string): string => `## What was corrected
- Fix ${n}.

## The pattern to follow from now on
- Pattern ${n}.

## Guards
- tests/a.test.ts › ${n}

## What the next phases need to know
- Know ${n}.
`;

describe("renderReviewCorrectionsSection", () => {
  it("is null when no stop has closed", () => {
    expect(renderReviewCorrectionsSection([])).toBeNull();
  });

  it("holds one stop with its handoff verbatim and its changed files", () => {
    const section = renderReviewCorrectionsSection([
      { phaseId: "phase-03", handoff: handoff("a"), changedFiles: ["src/export/invoiceRow.ts"] },
    ]);
    expect(section).toContain("## Review corrections");
    expect(section).toContain("reviewed and corrected the run at phase-03.");
    expect(section).toContain("### phase-03 (interactive)");
    expect(section).toContain(handoff("a").trimEnd());
    expect(section).toContain("Files changed by the review:\n- src/export/invoiceRow.ts");
  });

  it("keeps plan order across two stops and names both", () => {
    const section = renderReviewCorrectionsSection([
      { phaseId: "phase-03", handoff: handoff("a"), changedFiles: [] },
      { phaseId: "phase-05", handoff: handoff("b"), changedFiles: ["x.ts"] },
    ]);
    expect(section).toContain("at phase-03 and phase-05.");
    expect(section?.indexOf("### phase-03 (interactive)")).toBeLessThan(
      section?.indexOf("### phase-05 (interactive)") ?? -1,
    );
    expect(section).toContain("No file changed.");
  });

  it("says the section wins and the phase's own plan section still binds", () => {
    const section = renderReviewCorrectionsSection([
      { phaseId: "phase-03", handoff: handoff("a"), changedFiles: [] },
    ]);
    expect(section).toContain(
      "Where this section disagrees with an earlier phase's handoff, this section wins.",
    );
    expect(section).toContain("Your own plan section still binds.");
  });

  it("joins three stops with commas and an and", () => {
    const section = renderReviewCorrectionsSection(
      ["phase-02", "phase-03", "phase-05"].map((phaseId) => ({
        phaseId,
        handoff: "h",
        changedFiles: [],
      })),
    );
    expect(section).toContain("at phase-02, phase-03 and phase-05.");
  });
});
