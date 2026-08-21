import { describe, expect, it } from "vitest";
import { toCodeReviewAttentionPoints } from "../../../src/domain/review/codeReviewWorklist.js";
import type {
  GlobalFileEntry,
  GlobalFileReconciliation,
} from "../../../src/schemas/globalReconciliation.js";

function makeEntry(overrides: Partial<GlobalFileEntry>): GlobalFileEntry {
  return {
    path: "src/x.ts",
    plannedInPhases: [],
    touchedInPhases: [],
    optionalInPhases: [],
    expectedActions: [],
    actualActions: [],
    status: "unplanned",
    planned: false,
    unplanned: true,
    missing: false,
    extraTouch: false,
    attention: "review",
    ...overrides,
  };
}

function makeReconciliation(attentionPoints: readonly GlobalFileEntry[]): GlobalFileReconciliation {
  return {
    files: [],
    unplanned: [],
    missing: [],
    attentionPoints,
  };
}

describe("toCodeReviewAttentionPoints", () => {
  it("maps path, status, and the sorted/deduped union of phases", () => {
    const reconciliation = makeReconciliation([
      makeEntry({
        path: "src/unplanned.ts",
        status: "unplanned",
        touchedInPhases: ["phase-02", "phase-01"],
      }),
      makeEntry({
        path: "src/missing.ts",
        status: "missing",
        plannedInPhases: ["phase-01"],
      }),
      makeEntry({
        path: "src/optional.ts",
        status: "optional-touched",
        optionalInPhases: ["phase-03"],
        touchedInPhases: ["phase-03"],
      }),
    ]);

    const result = toCodeReviewAttentionPoints(reconciliation);

    expect(result).toEqual([
      { path: "src/unplanned.ts", status: "unplanned", phaseRef: "phase-01, phase-02" },
      { path: "src/missing.ts", status: "missing", phaseRef: "phase-01" },
      { path: "src/optional.ts", status: "optional-touched", phaseRef: "phase-03" },
    ]);
  });

  it("de-duplicates phases across the three sources", () => {
    const reconciliation = makeReconciliation([
      makeEntry({
        path: "src/dup.ts",
        touchedInPhases: ["phase-02"],
        plannedInPhases: ["phase-02", "phase-01"],
        optionalInPhases: ["phase-01"],
      }),
    ]);

    const result = toCodeReviewAttentionPoints(reconciliation);

    expect(result[0]?.phaseRef).toBe("phase-01, phase-02");
  });

  it("falls back to '—' when all phase lists are empty", () => {
    const reconciliation = makeReconciliation([makeEntry({ path: "src/orphan.ts" })]);

    const result = toCodeReviewAttentionPoints(reconciliation);

    expect(result[0]?.phaseRef).toBe("—");
  });

  it("preserves input order", () => {
    const reconciliation = makeReconciliation([
      makeEntry({ path: "src/c.ts" }),
      makeEntry({ path: "src/a.ts" }),
      makeEntry({ path: "src/b.ts" }),
    ]);

    const result = toCodeReviewAttentionPoints(reconciliation);

    expect(result.map((r) => r.path)).toEqual(["src/c.ts", "src/a.ts", "src/b.ts"]);
  });

  it("returns an empty array for empty input", () => {
    expect(toCodeReviewAttentionPoints(makeReconciliation([]))).toEqual([]);
  });
});
