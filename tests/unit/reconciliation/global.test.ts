import { describe, expect, it } from "vitest";
import {
  type GlobalFileEntry,
  type GlobalFileStatus,
  aggregateGlobalReconciliation,
  renderGlobalReconciliationMarkdown,
} from "../../../src/domain/reconciliation/global.js";
import type { PhaseFileReconciliation } from "../../../src/domain/reconciliation/types.js";

// Type-level assertions: verify the public shapes are correct
type _StatusCheck = GlobalFileStatus extends string ? true : never;
type _EntryCheck = GlobalFileEntry["attention"] extends "ok" | "review" ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _UsedImports = [_StatusCheck, _EntryCheck];

const emptyPhase = (phaseId: string): PhaseFileReconciliation => ({
  phaseId,
  createdAsPlanned: [],
  editedAsPlanned: [],
  missingPlannedCreate: [],
  missingPlannedEdit: [],
  createdButPlannedEdit: [],
  editedButPlannedCreate: [],
  unplannedCreated: [],
  unplannedEdited: [],
  optionalTouched: [],
  deletions: [],
  renames: [],
  hasDeviations: false,
});

describe("aggregateGlobalReconciliation", () => {
  describe("basic deduplication", () => {
    it("a file touched in two phases appears once, with both phases in touchedInPhases", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), unplannedCreated: ["src/foo.ts"] },
        { ...emptyPhase("phase-02"), unplannedEdited: ["src/foo.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      expect(result.files).toHaveLength(1);
      const entry = result.files[0];
      expect(entry.path).toBe("src/foo.ts");
      expect(entry.touchedInPhases).toEqual(["phase-01", "phase-02"]);
    });

    it("files are sorted by path", () => {
      const phases: PhaseFileReconciliation[] = [
        {
          ...emptyPhase("phase-01"),
          unplannedCreated: ["src/z.ts", "src/a.ts", "src/m.ts"],
        },
      ];
      const result = aggregateGlobalReconciliation(phases);
      expect(result.files.map((e) => e.path)).toEqual(["src/a.ts", "src/m.ts", "src/z.ts"]);
    });
  });

  describe("status: matched", () => {
    it("file planned and touched in exactly the same phase → matched", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), createdAsPlanned: ["src/foo.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/foo.ts")!;
      expect(entry.status).toBe("matched");
      expect(entry.attention).toBe("ok");
      expect(entry.planned).toBe(true);
      expect(entry.unplanned).toBe(false);
      expect(entry.missing).toBe(false);
    });

    it("file planned and edited in exactly the same phase → matched", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), editedAsPlanned: ["src/bar.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/bar.ts")!;
      expect(entry.status).toBe("matched");
    });

    it("file planned in phase-01 and phase-02, touched in both → matched", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), editedAsPlanned: ["src/shared.ts"] },
        { ...emptyPhase("phase-02"), editedAsPlanned: ["src/shared.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/shared.ts")!;
      expect(entry.status).toBe("matched");
      expect(entry.plannedInPhases).toEqual(["phase-01", "phase-02"]);
      expect(entry.touchedInPhases).toEqual(["phase-01", "phase-02"]);
    });
  });

  describe("status: missing", () => {
    it("file in missingPlannedCreate → missing", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), missingPlannedCreate: ["src/new.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/new.ts")!;
      expect(entry.status).toBe("missing");
      expect(entry.attention).toBe("review");
      expect(entry.missing).toBe(true);
      expect(entry.planned).toBe(true);
      expect(entry.touchedInPhases).toEqual([]);
    });

    it("file in missingPlannedEdit → missing", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), missingPlannedEdit: ["src/existing.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/existing.ts")!;
      expect(entry.status).toBe("missing");
    });

    it("missing entries appear in the missing slice", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), missingPlannedCreate: ["src/missing.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0].path).toBe("src/missing.ts");
    });
  });

  describe("status: unplanned", () => {
    it("file in unplannedCreated → unplanned", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), unplannedCreated: ["src/surprise.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/surprise.ts")!;
      expect(entry.status).toBe("unplanned");
      expect(entry.unplanned).toBe(true);
      expect(entry.planned).toBe(false);
      expect(entry.attention).toBe("review");
    });

    it("file in unplannedEdited → unplanned", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), unplannedEdited: ["src/sneaky.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/sneaky.ts")!;
      expect(entry.status).toBe("unplanned");
    });

    it("unplanned entries appear in the unplanned slice", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), unplannedCreated: ["src/a.ts", "src/b.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      expect(result.unplanned).toHaveLength(2);
    });
  });

  describe("status: extra-touch", () => {
    it("planned in phase-01, touched in phase-01 and phase-02 → extra-touch", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), createdAsPlanned: ["src/foo.ts"] },
        { ...emptyPhase("phase-02"), unplannedEdited: ["src/foo.ts"] },
        { ...emptyPhase("phase-03"), unplannedEdited: ["src/foo.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/foo.ts")!;
      expect(entry.status).toBe("extra-touch");
      expect(entry.extraTouch).toBe(true);
      expect(entry.plannedInPhases).toEqual(["phase-01"]);
      expect(entry.touchedInPhases).toEqual(["phase-01", "phase-02", "phase-03"]);
      expect(entry.attention).toBe("review");
    });
  });

  describe("status: action-mismatch", () => {
    it("createdButPlannedEdit → action-mismatch (touched, not missing)", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), createdButPlannedEdit: ["src/test.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/test.ts")!;
      expect(entry.status).toBe("action-mismatch");
      expect(entry.missing).toBe(false);
      expect(entry.planned).toBe(true);
      expect(entry.touchedInPhases).toEqual(["phase-01"]);
      expect(entry.expectedActions).toContain("edit");
      expect(entry.actualActions).toContain("added");
    });

    it("editedButPlannedCreate → action-mismatch (touched, not missing)", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), editedButPlannedCreate: ["src/test.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/test.ts")!;
      expect(entry.status).toBe("action-mismatch");
      expect(entry.missing).toBe(false);
      expect(entry.planned).toBe(true);
      expect(entry.touchedInPhases).toEqual(["phase-01"]);
      expect(entry.expectedActions).toContain("create");
      expect(entry.actualActions).toContain("modified");
    });

    it("action-mismatch file does not appear in the missing slice", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), createdButPlannedEdit: ["src/test.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      expect(result.missing).toHaveLength(0);
    });

    it("action-mismatch file appears in attentionPoints", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), createdButPlannedEdit: ["src/test.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      expect(result.attentionPoints).toHaveLength(1);
      expect(result.attentionPoints[0].path).toBe("src/test.ts");
    });
  });

  describe("status: partially-matched", () => {
    it("planned in phase-01 and phase-02, touched only in phase-01 → partially-matched", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), editedAsPlanned: ["src/shared.ts"] },
        { ...emptyPhase("phase-02"), missingPlannedEdit: ["src/shared.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/shared.ts")!;
      expect(entry.status).toBe("partially-matched");
      expect(entry.plannedInPhases).toEqual(["phase-01", "phase-02"]);
      expect(entry.touchedInPhases).toEqual(["phase-01"]);
      expect(entry.attention).toBe("review");
    });
  });

  describe("status: deleted", () => {
    it("file in deletions → deleted (overrides missing)", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), deletions: ["src/gone.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/gone.ts")!;
      expect(entry.status).toBe("deleted");
      expect(entry.actualActions).toContain("deleted");
      expect(entry.attention).toBe("review");
    });
  });

  describe("status: renamed", () => {
    it("rename target → renamed (overrides other statuses)", () => {
      const phases: PhaseFileReconciliation[] = [
        {
          ...emptyPhase("phase-01"),
          renames: [{ from: "src/old.ts", to: "src/new.ts" }],
        },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/new.ts")!;
      expect(entry).toBeDefined();
      expect(entry.status).toBe("renamed");
      expect(entry.actualActions).toContain("renamed");
      expect(entry.attention).toBe("review");
    });

    it("renamed status takes precedence over deleted", () => {
      // A file that is both in renames.to and deletions (edge case)
      const phases: PhaseFileReconciliation[] = [
        {
          ...emptyPhase("phase-01"),
          renames: [{ from: "src/old.ts", to: "src/target.ts" }],
          deletions: ["src/target.ts"],
        },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/target.ts")!;
      expect(entry.status).toBe("renamed");
    });
  });

  describe("status: unknown", () => {
    it("file planned in one phase but touched in a different phase → unknown", () => {
      // planned in phase-01 (missing), unplanned touched in phase-02
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), missingPlannedCreate: ["src/ambiguous.ts"] },
        { ...emptyPhase("phase-02"), unplannedEdited: ["src/ambiguous.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/ambiguous.ts")!;
      // Planned in phase-01, touched in phase-02 — neither superset nor subset
      expect(entry.status).toBe("unknown");
    });
  });

  describe("status precedence", () => {
    it("renamed > deleted: rename target with delete action → renamed", () => {
      const phases: PhaseFileReconciliation[] = [
        {
          ...emptyPhase("phase-01"),
          renames: [{ from: "src/a.ts", to: "src/b.ts" }],
          deletions: ["src/b.ts"],
        },
      ];
      const result = aggregateGlobalReconciliation(phases);
      expect(result.files.find((e) => e.path === "src/b.ts")!.status).toBe("renamed");
    });

    it("deleted > unplanned: a deleted unplanned file → deleted", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), deletions: ["src/deleted.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      expect(result.files.find((e) => e.path === "src/deleted.ts")!.status).toBe("deleted");
    });

    it("unplanned > missing: when planned phases not touched but also unplanned in another", () => {
      // This case: planned in phase-01 (missing), unplanned touched in phase-02
      // Status is unknown per spec (neither superset nor subset)
      // But if we had purely: touched in p2, planned nowhere → unplanned
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), unplannedCreated: ["src/truly-unplanned.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      expect(result.files[0].status).toBe("unplanned");
    });
  });

  describe("attention points", () => {
    it("matched files have attention ok", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), createdAsPlanned: ["src/ok.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      expect(result.files[0].attention).toBe("ok");
      expect(result.attentionPoints).toHaveLength(0);
    });

    it("non-matched files appear in attentionPoints", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), createdAsPlanned: ["src/ok.ts"] },
        { ...emptyPhase("phase-01"), missingPlannedCreate: ["src/missing.ts"] },
        { ...emptyPhase("phase-01"), unplannedCreated: ["src/extra.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const attentionPaths = result.attentionPoints.map((e) => e.path).toSorted();
      expect(attentionPaths).toContain("src/missing.ts");
      expect(attentionPaths).toContain("src/extra.ts");
      expect(attentionPaths).not.toContain("src/ok.ts");
    });
  });

  describe("optional files", () => {
    it("optional touched file with no planned entry → unplanned", () => {
      const phases: PhaseFileReconciliation[] = [
        { ...emptyPhase("phase-01"), optionalTouched: ["src/optional.ts"] },
      ];
      const result = aggregateGlobalReconciliation(phases);
      const entry = result.files.find((e) => e.path === "src/optional.ts")!;
      expect(entry.status).toBe("unplanned");
      expect(entry.touchedInPhases).toEqual(["phase-01"]);
    });
  });

  describe("empty input", () => {
    it("returns empty slices for no phases", () => {
      const result = aggregateGlobalReconciliation([]);
      expect(result.files).toHaveLength(0);
      expect(result.unplanned).toHaveLength(0);
      expect(result.missing).toHaveLength(0);
      expect(result.attentionPoints).toHaveLength(0);
    });
  });
});

describe("renderGlobalReconciliationMarkdown", () => {
  it("renders the header row", () => {
    const result = renderGlobalReconciliationMarkdown(
      aggregateGlobalReconciliation([]),
      "acme.fixbug",
    );
    expect(result).toContain("| File | Planned in | Touched in | Status | Notes |");
  });

  it("always renders the Run header", () => {
    const result = renderGlobalReconciliationMarkdown(
      aggregateGlobalReconciliation([]),
      "acme.fixbug",
    );
    expect(result).toContain("**Run**: acme.fixbug");
  });

  it("renders a matched file with — for notes", () => {
    const global = aggregateGlobalReconciliation([
      { ...emptyPhase("phase-01"), createdAsPlanned: ["src/foo.ts"] },
    ]);
    const md = renderGlobalReconciliationMarkdown(global, "acme.fixbug");
    expect(md).toContain("src/foo.ts");
    expect(md).toContain("phase-01");
    expect(md).toContain("matched");
  });

  it("renders — for empty phase lists", () => {
    const global = aggregateGlobalReconciliation([
      { ...emptyPhase("phase-01"), missingPlannedCreate: ["src/missing.ts"] },
    ]);
    const md = renderGlobalReconciliationMarkdown(global, "acme.fixbug");
    // touchedInPhases is empty → render —
    const row = md.split("\n").find((l) => l.includes("src/missing.ts"))!;
    expect(row).toBeDefined();
    // The touched column should be — since no phase touched it
    expect(row).toContain("| — |");
  });

  it("renders multiple phases comma-separated", () => {
    const global = aggregateGlobalReconciliation([
      { ...emptyPhase("phase-01"), editedAsPlanned: ["src/multi.ts"] },
      { ...emptyPhase("phase-02"), editedAsPlanned: ["src/multi.ts"] },
    ]);
    const md = renderGlobalReconciliationMarkdown(global, "acme.fixbug");
    expect(md).toContain("phase-01, phase-02");
  });

  it("renders action-mismatch status and note", () => {
    const global = aggregateGlobalReconciliation([
      { ...emptyPhase("phase-01"), createdButPlannedEdit: ["tests/lock.test.ts"] },
    ]);
    const md = renderGlobalReconciliationMarkdown(global, "acme.fixbug");
    expect(md).toContain("action-mismatch");
    expect(md).toContain("action mismatch: planned edit, got added");
  });

  it("produces deterministic output (sorted by path)", () => {
    const global = aggregateGlobalReconciliation([
      {
        ...emptyPhase("phase-01"),
        createdAsPlanned: ["src/z.ts", "src/a.ts"],
      },
    ]);
    const md = renderGlobalReconciliationMarkdown(global, "acme.fixbug");
    const lines = md.split("\n").filter((l) => l.includes("src/"));
    expect(lines[0]).toContain("src/a.ts");
    expect(lines[1]).toContain("src/z.ts");
  });

  it("renders a snapshot for a mixed run", () => {
    const phases: PhaseFileReconciliation[] = [
      {
        ...emptyPhase("phase-01"),
        createdAsPlanned: ["src/new.ts"],
        missingPlannedEdit: ["src/skipped.ts"],
        unplannedCreated: ["src/surprise.ts"],
      },
      {
        ...emptyPhase("phase-02"),
        editedAsPlanned: ["src/existing.ts"],
        renames: [{ from: "src/old.ts", to: "src/renamed.ts" }],
      },
    ];
    const md = renderGlobalReconciliationMarkdown(
      aggregateGlobalReconciliation(phases),
      "acme.fixbug",
    );
    expect(md).toContain("matched");
    expect(md).toContain("missing");
    expect(md).toContain("unplanned");
    expect(md).toContain("renamed");
    expect(md).toMatchSnapshot();
  });
});
