import { describe, expect, it } from "vitest";
import { reconcile } from "../../../src/domain/reconciliation/reconcile.js";
import type { NameStatusEntry, PlannedFiles } from "../../../src/domain/reconciliation/types.js";

const planned: PlannedFiles = {
  create: ["src/new.ts", "src/other.ts"],
  edit: ["src/existing.ts"],
  optional: ["src/maybe.ts"],
};

describe("reconcile", () => {
  it("identifies files created as planned", () => {
    const entries: NameStatusEntry[] = [
      { status: "added", path: "src/new.ts" },
      { status: "added", path: "src/other.ts" },
      { status: "modified", path: "src/existing.ts" },
    ];
    const result = reconcile(planned, entries);
    expect(result.createdAsPlanned).toEqual(["src/new.ts", "src/other.ts"]);
    expect(result.missingPlannedCreate).toEqual([]);
    expect(result.editedAsPlanned).toEqual(["src/existing.ts"]);
    expect(result.missingPlannedEdit).toEqual([]);
    expect(result.unplannedCreated).toEqual([]);
    expect(result.unplannedEdited).toEqual([]);
    expect(result.hasDeviations).toBe(false);
  });

  it("reports missing planned creates", () => {
    const entries: NameStatusEntry[] = [
      { status: "added", path: "src/new.ts" },
      { status: "modified", path: "src/existing.ts" },
    ];
    const result = reconcile(planned, entries);
    expect(result.missingPlannedCreate).toEqual(["src/other.ts"]);
    expect(result.hasDeviations).toBe(true);
  });

  it("reports missing planned edits", () => {
    const entries: NameStatusEntry[] = [
      { status: "added", path: "src/new.ts" },
      { status: "added", path: "src/other.ts" },
    ];
    const result = reconcile(planned, entries);
    expect(result.missingPlannedEdit).toEqual(["src/existing.ts"]);
    expect(result.hasDeviations).toBe(true);
  });

  it("reports unplanned created files", () => {
    const entries: NameStatusEntry[] = [
      { status: "added", path: "src/new.ts" },
      { status: "added", path: "src/other.ts" },
      { status: "added", path: "src/surprise.ts" },
      { status: "modified", path: "src/existing.ts" },
    ];
    const result = reconcile(planned, entries);
    expect(result.unplannedCreated).toEqual(["src/surprise.ts"]);
    expect(result.hasDeviations).toBe(true);
  });

  it("reports unplanned edited files", () => {
    const entries: NameStatusEntry[] = [
      { status: "added", path: "src/new.ts" },
      { status: "added", path: "src/other.ts" },
      { status: "modified", path: "src/existing.ts" },
      { status: "modified", path: "src/unplanned-edit.ts" },
    ];
    const result = reconcile(planned, entries);
    expect(result.unplannedEdited).toEqual(["src/unplanned-edit.ts"]);
    expect(result.hasDeviations).toBe(true);
  });

  it("touching an optional file is never a deviation", () => {
    const entries: NameStatusEntry[] = [
      { status: "added", path: "src/new.ts" },
      { status: "added", path: "src/other.ts" },
      { status: "modified", path: "src/existing.ts" },
      { status: "modified", path: "src/maybe.ts" },
    ];
    const result = reconcile(planned, entries);
    expect(result.optionalTouched).toEqual(["src/maybe.ts"]);
    expect(result.unplannedEdited).toEqual([]);
    expect(result.hasDeviations).toBe(false);
  });

  it("records deletions as deviations", () => {
    const entries: NameStatusEntry[] = [
      { status: "added", path: "src/new.ts" },
      { status: "added", path: "src/other.ts" },
      { status: "modified", path: "src/existing.ts" },
      { status: "deleted", path: "src/gone.ts" },
    ];
    const result = reconcile(planned, entries);
    expect(result.deletions).toEqual(["src/gone.ts"]);
    expect(result.hasDeviations).toBe(true);
  });

  it("records renames as deviations", () => {
    const entries: NameStatusEntry[] = [
      { status: "added", path: "src/new.ts" },
      { status: "added", path: "src/other.ts" },
      { status: "modified", path: "src/existing.ts" },
      { status: "renamed", path: "src/after.ts", oldPath: "src/before.ts" },
    ];
    const result = reconcile(planned, entries);
    expect(result.renames).toEqual([{ from: "src/before.ts", to: "src/after.ts" }]);
    expect(result.hasDeviations).toBe(true);
  });

  it("hasDeviations is false when everything matches exactly", () => {
    const entries: NameStatusEntry[] = [
      { status: "added", path: "src/new.ts" },
      { status: "added", path: "src/other.ts" },
      { status: "modified", path: "src/existing.ts" },
    ];
    const result = reconcile(planned, entries);
    expect(result.hasDeviations).toBe(false);
  });

  it("handles empty planned and empty entries", () => {
    const result = reconcile({ create: [], edit: [], optional: [] }, []);
    expect(result.hasDeviations).toBe(false);
    expect(result.createdAsPlanned).toEqual([]);
    expect(result.editedAsPlanned).toEqual([]);
  });

  it("preserves input order for stable output", () => {
    const entries: NameStatusEntry[] = [
      { status: "added", path: "src/z.ts" },
      { status: "added", path: "src/a.ts" },
    ];
    const p: PlannedFiles = { create: ["src/z.ts", "src/a.ts"], edit: [], optional: [] };
    const result = reconcile(p, entries);
    expect(result.createdAsPlanned).toEqual(["src/z.ts", "src/a.ts"]);
  });
});
