import { describe, expect, it } from "vitest";
import { summarizeInteractiveHandoff } from "../../../src/domain/interactive/handoff.js";
import {
  prPhaseStopSuffix,
  renderReviewedPhases,
  type ReviewedPhase,
} from "../../../src/domain/interactive/reviewedPhases.js";

const ada = { name: "Ada Example", email: "ada@example.com" };

const CORRECTED_HANDOFF = `## What was corrected
- The header row reads Invoice number.
- The amount column is right-aligned.
- The rounding follows the accountant's rule.

## The pattern to follow from now on
- Use EXPORT_LABELS.

## Guards
- tests/export/invoiceRow.test.ts › header uses EXPORT_LABELS
- lint rule no-raw-label
- no guard: the rounding rule is the accountant's

## What the next phases need to know
- Nothing.
`;

function phase(over: Partial<ReviewedPhase> & Pick<ReviewedPhase, "phaseId">): ReviewedPhase {
  return {
    cause: "held",
    outcome: "corrected",
    closedBy: ada,
    summary: summarizeInteractiveHandoff(CORRECTED_HANDOFF),
    ...over,
  };
}

describe("summarizeInteractiveHandoff", () => {
  it("counts corrections, named guards and no-guard entries", () => {
    const s = summarizeInteractiveHandoff(CORRECTED_HANDOFF);
    expect(s.corrections).toHaveLength(3);
    expect(s.guards).toEqual([
      "tests/export/invoiceRow.test.ts › header uses EXPORT_LABELS",
      "lint rule no-raw-label",
    ]);
    expect(s.noGuard).toEqual(["no guard: the rounding rule is the accountant's"]);
    expect(s.correctedSection).toContain("- The amount column is right-aligned.");
    expect(s.guardsSection).toContain("- lint rule no-raw-label");
    expect(s.correctedSection).not.toContain("## ");
  });

  it("returns nothing for text with no sections", () => {
    const s = summarizeInteractiveHandoff("no sections here");
    expect(s.corrections).toEqual([]);
    expect(s.guards).toEqual([]);
    expect(s.noGuard).toEqual([]);
  });
});

describe("renderReviewedPhases", () => {
  it("renders nothing when no phase stopped", () => {
    expect(renderReviewedPhases([])).toBe("");
  });

  it("renders the table and a section per corrected stop", () => {
    const unchanged = summarizeInteractiveHandoff(
      "## What was corrected\n- Nothing: the phase was reviewed and no file changed.\n\n## Guards\n- no guard: nothing was corrected.\n",
    );
    const text = renderReviewedPhases([
      phase({ phaseId: "phase-02" }),
      phase({ phaseId: "phase-03", cause: "declared" }),
      phase({ phaseId: "phase-04", outcome: "unchanged", summary: unchanged }),
    ]);
    expect(text).toContain("## Reviewed phases\n");
    expect(text).toContain("| Phase | Stop | Outcome | Closed by | Corrections | Guards |");
    expect(text).toContain("| phase-02 | held | corrected | Ada Example | 3 | 2 (1 no guard) |");
    expect(text).toContain(
      "| phase-03 | interactive | corrected | Ada Example | 3 | 2 (1 no guard) |",
    );
    expect(text).toContain("| phase-04 | held | unchanged | Ada Example | 0 | — |");
    expect(text).toContain("### phase-02 (held)");
    expect(text).toContain("### phase-03 (interactive)");
    expect(text).not.toContain("### phase-04");
    expect(text).toContain("- lint rule no-raw-label");
  });

  it("writes a guard count with no no-guard entry as a bare number", () => {
    const summary = summarizeInteractiveHandoff(
      "## What was corrected\n- One.\n\n## Guards\n- tests/a.test.ts\n",
    );
    expect(renderReviewedPhases([phase({ phaseId: "phase-02", summary })])).toContain("| 1 | 1 |");
  });
});

describe("prPhaseStopSuffix", () => {
  it("says 1 guard and 2 guards", () => {
    const one = summarizeInteractiveHandoff(
      "## What was corrected\n- One.\n\n## Guards\n- tests/a.test.ts\n",
    );
    expect(prPhaseStopSuffix(phase({ phaseId: "p", cause: "declared", summary: one }))).toBe(
      " · interactive, corrected by Ada Example (1 guard)",
    );
    expect(prPhaseStopSuffix(phase({ phaseId: "p" }))).toBe(
      " · held, corrected by Ada Example (2 guards)",
    );
  });

  it("says reviewed without change for an unchanged stop", () => {
    expect(prPhaseStopSuffix(phase({ phaseId: "p", outcome: "unchanged" }))).toBe(
      " · held, reviewed without change by Ada Example",
    );
    expect(
      prPhaseStopSuffix(phase({ phaseId: "p", cause: "declared", outcome: "unchanged" })),
    ).toBe(" · interactive, reviewed without change by Ada Example");
  });
});
