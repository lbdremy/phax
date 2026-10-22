import { describe, expect, it } from "vitest";
import {
  deviationPaths,
  findUnexplainedDeviations,
  findUnexplainedGlobalDeviations,
} from "../../../src/domain/reconciliation/explained.js";
import type {
  GlobalFileEntry,
  GlobalFileReconciliation,
} from "../../../src/domain/reconciliation/global.js";
import type { ReconciliationResult } from "../../../src/domain/reconciliation/types.js";
import { reconciliationResult } from "../../helpers/reconciliationFixture.js";

function makeResult(overrides: Partial<ReconciliationResult> = {}): ReconciliationResult {
  return reconciliationResult(overrides);
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

function entry(
  path: string,
  overrides: Partial<GlobalFileEntry> & Pick<GlobalFileEntry, "status">,
): GlobalFileEntry {
  return {
    path,
    plannedInPhases: [],
    touchedInPhases: [],
    optionalInPhases: [],
    reviewCorrectedInPhases: [],
    expectedActions: [],
    actualActions: [],
    planned: false,
    unplanned: false,
    missing: false,
    extraTouch: false,
    attention: "review",
    ...overrides,
  };
}

function makeGlobal(
  unplanned: readonly GlobalFileEntry[],
  missing: readonly GlobalFileEntry[],
): GlobalFileReconciliation {
  const files = [...unplanned, ...missing];
  return { files, unplanned, missing, attentionPoints: files };
}

describe("findUnexplainedGlobalDeviations", () => {
  it("excludes an unplanned entry named in its phase's handoff", () => {
    const global = makeGlobal(
      [entry("src/extra.ts", { status: "unplanned", unplanned: true, touchedInPhases: ["p1"] })],
      [],
    );
    const handoffs = [{ phaseId: "p1", handoffMd: "src/extra.ts was needed for X." }];
    expect(findUnexplainedGlobalDeviations(global, handoffs)).toEqual([]);
  });

  it("lists an unplanned entry absent from its phases' handoffs, with its phases", () => {
    const global = makeGlobal(
      [
        entry("src/extra.ts", {
          status: "unplanned",
          unplanned: true,
          touchedInPhases: ["p1", "p2"],
        }),
      ],
      [],
    );
    const handoffs = [
      { phaseId: "p1", handoffMd: "Nothing special." },
      { phaseId: "p2", handoffMd: "Still nothing." },
      { phaseId: "p3", handoffMd: "src/extra.ts is named here, in an unrelated phase." },
    ];
    expect(findUnexplainedGlobalDeviations(global, handoffs)).toEqual([
      { path: "src/extra.ts", kind: "unplanned", phaseIds: ["p1", "p2"] },
    ]);
  });

  it("counts a phase without a handoff as an empty one", () => {
    const global = makeGlobal(
      [entry("src/extra.ts", { status: "unplanned", unplanned: true, touchedInPhases: ["p1"] })],
      [],
    );
    expect(findUnexplainedGlobalDeviations(global, [])).toEqual([
      { path: "src/extra.ts", kind: "unplanned", phaseIds: ["p1"] },
    ]);
  });

  it("lists a missing entry with kind missing and its planned phases", () => {
    const global = makeGlobal(
      [],
      [entry("src/planned.ts", { status: "missing", missing: true, plannedInPhases: ["p2"] })],
    );
    expect(
      findUnexplainedGlobalDeviations(global, [{ phaseId: "p2", handoffMd: "Done." }]),
    ).toEqual([{ path: "src/planned.ts", kind: "missing", phaseIds: ["p2"] }]);
  });

  it("lists unplanned entries before missing ones", () => {
    const global = makeGlobal(
      [entry("z-unplanned.ts", { status: "unplanned", unplanned: true, touchedInPhases: ["p1"] })],
      [entry("a-missing.ts", { status: "missing", missing: true, plannedInPhases: ["p1"] })],
    );
    const kinds = findUnexplainedGlobalDeviations(global, [{ phaseId: "p1", handoffMd: "" }]).map(
      (d) => d.kind,
    );
    expect(kinds).toEqual(["unplanned", "missing"]);
  });
});
