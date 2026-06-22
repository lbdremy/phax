import { describe, expect, it } from "vitest";
import {
  deviationPaths,
  findUnexplainedDeviations,
} from "../../../src/domain/reconciliation/explained.js";
import type { ReconciliationResult } from "../../../src/domain/reconciliation/types.js";

function makeResult(overrides: Partial<ReconciliationResult> = {}): ReconciliationResult {
  return {
    createdAsPlanned: [],
    editedAsPlanned: [],
    missingPlannedCreate: [],
    missingPlannedEdit: [],
    unplannedCreated: [],
    unplannedEdited: [],
    optionalTouched: [],
    deletions: [],
    renames: [],
    hasDeviations: false,
    ...overrides,
  };
}

describe("deviationPaths", () => {
  it("returns empty array when no deviations", () => {
    expect(deviationPaths(makeResult())).toEqual([]);
  });

  it("includes unplannedCreated paths", () => {
    const result = makeResult({ unplannedCreated: ["src/extra.ts"], hasDeviations: true });
    expect(deviationPaths(result)).toContain("src/extra.ts");
  });

  it("includes unplannedEdited paths", () => {
    const result = makeResult({ unplannedEdited: ["src/other.ts"], hasDeviations: true });
    expect(deviationPaths(result)).toContain("src/other.ts");
  });

  it("includes missingPlannedCreate paths", () => {
    const result = makeResult({ missingPlannedCreate: ["src/new.ts"], hasDeviations: true });
    expect(deviationPaths(result)).toContain("src/new.ts");
  });

  it("includes missingPlannedEdit paths", () => {
    const result = makeResult({ missingPlannedEdit: ["src/edit.ts"], hasDeviations: true });
    expect(deviationPaths(result)).toContain("src/edit.ts");
  });

  it("deduplicates paths that appear in multiple categories", () => {
    const result = makeResult({
      unplannedCreated: ["src/dup.ts"],
      unplannedEdited: ["src/dup.ts"],
      hasDeviations: true,
    });
    const paths = deviationPaths(result);
    expect(paths.filter((p) => p === "src/dup.ts")).toHaveLength(1);
  });

  it("returns all four categories when all have entries", () => {
    const result = makeResult({
      unplannedCreated: ["a.ts"],
      unplannedEdited: ["b.ts"],
      missingPlannedCreate: ["c.ts"],
      missingPlannedEdit: ["d.ts"],
      hasDeviations: true,
    });
    expect(deviationPaths(result)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });
});

describe("findUnexplainedDeviations", () => {
  it("returns empty when paths is empty", () => {
    expect(findUnexplainedDeviations([], "## What the next phase needs to know")).toEqual([]);
  });

  it("returns all paths when handoff is empty", () => {
    expect(findUnexplainedDeviations(["src/a.ts", "src/b.ts"], "")).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("excludes paths mentioned in the handoff", () => {
    const handoff = "## What the next phase needs to know\n\nsrc/a.ts was added for X.";
    expect(findUnexplainedDeviations(["src/a.ts", "src/b.ts"], handoff)).toEqual(["src/b.ts"]);
  });

  it("finds path mentioned only inside a longer string", () => {
    const handoff = "Changed /some/dir/src/a.ts because of reasons.";
    expect(findUnexplainedDeviations(["src/a.ts"], handoff)).toEqual([]);
  });

  it("returns unexplained paths when none are mentioned", () => {
    const handoff = "## What the next phase needs to know\n\nNo special deviations.";
    expect(findUnexplainedDeviations(["src/missing.ts"], handoff)).toEqual(["src/missing.ts"]);
  });
});
