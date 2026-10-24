import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_HANDOFF_SECTIONS,
  REVIEWED_WITHOUT_CHANGE_HANDOFF,
  renderInteractiveHandoff,
  summarizeInteractiveHandoff,
  validateInteractiveHandoff,
} from "../../../src/domain/interactive/handoff.js";
import type { InteractiveHandoff } from "../../../src/schemas/interactiveHandoff.js";

const VALID = `## What was corrected
- The header row reads \`Invoice number\`, not \`invoice_no\`.
- A missing tax id fails the export with the row number instead of skipping the row.
- The column order is kept as the plan states it.

## The pattern to follow from now on
- Header labels come from \`EXPORT_LABELS\`.

## Guards
- tests/export/invoiceRow.test.ts › header uses EXPORT_LABELS
- tests/export/invoiceRow.test.ts › missing tax id fails with row number
- no guard: the order is the accountant's, stated in the plan, not checkable here

## What the next phases need to know
- phase-04 and phase-05 add their labels to \`EXPORT_LABELS\`.
`;

const defectsOf = (markdown: string): readonly string[] => {
  const result = validateInteractiveHandoff(markdown);
  if (Either.isRight(result)) throw new Error("expected defects");
  return result.left;
};

describe("validateInteractiveHandoff", () => {
  it("returns a valid handoff unchanged", () => {
    expect(validateInteractiveHandoff(VALID)).toEqual(Either.right(VALID));
  });

  it("accepts numbered entries and indented continuation lines", () => {
    const md = VALID.replace("- The column order is kept", "- The column order\n  is kept").replace(
      "- no guard: the order",
      "- no guard: the order\n  (see the plan)",
    );
    expect(Either.isRight(validateInteractiveHandoff(md))).toBe(true);
    const numbered = `## What was corrected
1. One thing.

## The pattern to follow from now on
- none

## Guards
1. tests/a.test.ts › one

## What the next phases need to know
- none
`;
    expect(Either.isRight(validateInteractiveHandoff(numbered))).toBe(true);
  });

  it("names a missing ## Guards section", () => {
    const md = VALID.replace(/## Guards[\s\S]*?(?=## What the next)/, "");
    expect(defectsOf(md)).toContain('missing section "## Guards"');
  });

  it("names sections out of order", () => {
    const md = `## The pattern to follow from now on
- p

## What was corrected
- c

## Guards
- tests/a.test.ts › c

## What the next phases need to know
- n
`;
    const defects = defectsOf(md);
    expect(defects.some((d) => d.includes("out of order"))).toBe(true);
    expect(defects.some((d) => d.includes("## What was corrected"))).toBe(true);
  });

  it("names a count mismatch: three corrections, two guards", () => {
    const md = VALID.replace(
      "- no guard: the order is the accountant's, stated in the plan, not checkable here\n",
      "",
    );
    expect(defectsOf(md)).toEqual([
      '"## Guards" holds 2 entries for 3 corrections: one guard per correction, in order',
    ]);
  });

  it("refuses an empty list of corrections", () => {
    const md = VALID.replace(/- The header row[\s\S]*?plan states it\.\n/, "");
    expect(defectsOf(md).some((d) => d.includes("lists no correction"))).toBe(true);
  });

  it("refuses a bare `no guard:`", () => {
    const md = VALID.replace(
      "- no guard: the order is the accountant's, stated in the plan, not checkable here",
      "- no guard:",
    );
    expect(defectsOf(md).some((d) => d.includes("without a reason"))).toBe(true);
  });

  it("refuses an unexpected and a repeated section", () => {
    expect(defectsOf(`${VALID}\n## Extra\n- x\n`)).toContain('unexpected section "## Extra"');
    expect(defectsOf(`${VALID}\n## Guards\n- x\n`).some((d) => d.includes("appears 2 times"))).toBe(
      true,
    );
  });

  it("does not read a heading inside a code fence", () => {
    const md = VALID.replace(
      "- Header labels come from `EXPORT_LABELS`.",
      "- Header labels come from `EXPORT_LABELS`:\n\n```md\n## Not a section\n```",
    );
    expect(Either.isRight(validateInteractiveHandoff(md))).toBe(true);
  });

  it("refuses an empty document with the four missing sections", () => {
    expect(defectsOf("")).toHaveLength(4);
  });
});

describe("renderInteractiveHandoff", () => {
  const answer: InteractiveHandoff = {
    corrections: [
      {
        what: "The header row reads `Invoice number`.",
        guard: { kind: "test", ref: "tests/export/invoiceRow.test.ts › header uses EXPORT_LABELS" },
      },
      {
        what: "The column order\nis kept as the plan states it.",
        guard: { kind: "none", reason: "the order is the accountant's" },
      },
    ],
    patternFromNowOn: ["Header labels come from `EXPORT_LABELS`."],
    nextPhasesNeedToKnow: [],
  };

  it("renders the four sections in order", () => {
    const text = renderInteractiveHandoff(answer);
    const positions = INTERACTIVE_HANDOFF_SECTIONS.map((s) => text.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions.toSorted((a, b) => a - b)).toEqual(positions);
  });

  it("writes a none guard as `no guard: <reason>` and an empty list as none", () => {
    const text = renderInteractiveHandoff(answer);
    expect(text).toContain("- no guard: the order is the accountant's");
    expect(text).toContain("- tests/export/invoiceRow.test.ts › header uses EXPORT_LABELS");
    expect(text).toMatch(/## What the next phases need to know\n- none\n/);
  });

  it("renders a document that validates, even with multi-line entries", () => {
    const text = renderInteractiveHandoff(answer);
    expect(text).toContain("- The column order is kept as the plan states it.");
    expect(Either.isRight(validateInteractiveHandoff(text))).toBe(true);
  });
});

describe("REVIEWED_WITHOUT_CHANGE_HANDOFF", () => {
  it("passes validation", () => {
    expect(Either.isRight(validateInteractiveHandoff(REVIEWED_WITHOUT_CHANGE_HANDOFF))).toBe(true);
  });

  it("summarizes as one correction line and one no-guard entry", () => {
    const s = summarizeInteractiveHandoff(REVIEWED_WITHOUT_CHANGE_HANDOFF);
    expect(s.corrections).toHaveLength(1);
    expect(s.guards).toEqual([]);
    expect(s.noGuard).toEqual(["no guard: nothing was corrected."]);
  });
});
