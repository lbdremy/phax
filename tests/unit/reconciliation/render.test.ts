import { describe, expect, it } from "vitest";
import { renderReconciliationMarkdown } from "../../../src/domain/reconciliation/render.js";
import type {
  PlannedFiles,
  ReconciliationResult,
} from "../../../src/domain/reconciliation/types.js";

const planned: PlannedFiles = {
  create: ["src/new.ts", "src/other.ts"],
  edit: ["src/existing.ts"],
  optional: ["src/maybe.ts"],
};

describe("renderReconciliationMarkdown", () => {
  it("renders the section heading", () => {
    const result: ReconciliationResult = {
      createdAsPlanned: ["src/new.ts", "src/other.ts"],
      editedAsPlanned: ["src/existing.ts"],
      missingPlannedCreate: [],
      missingPlannedEdit: [],
      unplannedCreated: [],
      unplannedEdited: [],
      optionalTouched: [],
      deletions: [],
      renames: [],
      hasDeviations: false,
    };
    const md = renderReconciliationMarkdown(result, planned);
    expect(md).toContain("## PHAX File Reconciliation");
  });

  it("renders checkbox lists for planned creates and edits", () => {
    const result: ReconciliationResult = {
      createdAsPlanned: ["src/new.ts"],
      editedAsPlanned: ["src/existing.ts"],
      missingPlannedCreate: ["src/other.ts"],
      missingPlannedEdit: [],
      unplannedCreated: [],
      unplannedEdited: [],
      optionalTouched: [],
      deletions: [],
      renames: [],
      hasDeviations: true,
    };
    const md = renderReconciliationMarkdown(result, planned);
    expect(md).toContain("[x] src/new.ts");
    expect(md).toContain("[ ] src/other.ts");
    expect(md).toContain("[x] src/existing.ts");
  });

  it("renders the deviation note for unplanned created files", () => {
    const result: ReconciliationResult = {
      createdAsPlanned: [],
      editedAsPlanned: [],
      missingPlannedCreate: [],
      missingPlannedEdit: [],
      unplannedCreated: ["src/surprise.ts"],
      unplannedEdited: [],
      optionalTouched: [],
      deletions: [],
      renames: [],
      hasDeviations: true,
    };
    const md = renderReconciliationMarkdown(result, planned);
    expect(md).toContain("src/surprise.ts");
    expect(md).toContain("Deviation");
    expect(md).toContain("phase-handoff.md");
  });

  it("renders the deviation note for unplanned edited files", () => {
    const result: ReconciliationResult = {
      createdAsPlanned: [],
      editedAsPlanned: [],
      missingPlannedCreate: [],
      missingPlannedEdit: [],
      unplannedCreated: [],
      unplannedEdited: ["src/extra.ts"],
      optionalTouched: [],
      deletions: [],
      renames: [],
      hasDeviations: true,
    };
    const md = renderReconciliationMarkdown(result, planned);
    expect(md).toContain("src/extra.ts");
    expect(md).toContain("Deviation");
    expect(md).toContain("phase-handoff.md");
  });

  it("renders optional touched section", () => {
    const result: ReconciliationResult = {
      createdAsPlanned: [],
      editedAsPlanned: [],
      missingPlannedCreate: [],
      missingPlannedEdit: [],
      unplannedCreated: [],
      unplannedEdited: [],
      optionalTouched: ["src/maybe.ts"],
      deletions: [],
      renames: [],
      hasDeviations: false,
    };
    const md = renderReconciliationMarkdown(result, planned);
    expect(md).toContain("src/maybe.ts");
  });

  it("includes a one-line summary", () => {
    const result: ReconciliationResult = {
      createdAsPlanned: ["src/new.ts", "src/other.ts"],
      editedAsPlanned: ["src/existing.ts"],
      missingPlannedCreate: [],
      missingPlannedEdit: [],
      unplannedCreated: [],
      unplannedEdited: [],
      optionalTouched: [],
      deletions: [],
      renames: [],
      hasDeviations: false,
    };
    const md = renderReconciliationMarkdown(result, planned);
    expect(md).toContain("No deviations");
  });

  it("summary mentions deviations when present", () => {
    const result: ReconciliationResult = {
      createdAsPlanned: [],
      editedAsPlanned: [],
      missingPlannedCreate: ["src/new.ts"],
      missingPlannedEdit: [],
      unplannedCreated: [],
      unplannedEdited: [],
      optionalTouched: [],
      deletions: [],
      renames: [],
      hasDeviations: true,
    };
    const md = renderReconciliationMarkdown(result, planned);
    expect(md.toLowerCase()).toContain("deviation");
  });
});
