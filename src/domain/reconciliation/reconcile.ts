import type { NameStatusEntry, PlannedFiles, ReconciliationResult } from "./types.js";

export function reconcile(
  planned: PlannedFiles,
  entries: readonly NameStatusEntry[],
): ReconciliationResult {
  const created = new Set<string>();
  const edited = new Set<string>();
  const deleted: string[] = [];
  const renames: { from: string; to: string }[] = [];

  for (const entry of entries) {
    if (entry.status === "added") {
      created.add(entry.path);
    } else if (entry.status === "modified") {
      edited.add(entry.path);
    } else if (entry.status === "deleted") {
      deleted.push(entry.path);
    } else if (entry.status === "renamed" && entry.oldPath) {
      renames.push({ from: entry.oldPath, to: entry.path });
    }
  }

  const planSet = new Set([...planned.create, ...planned.edit, ...planned.optional]);
  const optionalSet = new Set(planned.optional);

  const createdAsPlanned = planned.create.filter((f) => created.has(f));
  const missingPlannedCreate = planned.create.filter((f) => !created.has(f));
  const editedAsPlanned = planned.edit.filter((f) => edited.has(f));
  const missingPlannedEdit = planned.edit.filter((f) => !edited.has(f));

  const unplannedCreated = [...created].filter((f) => !planSet.has(f));
  const unplannedEdited = [...edited].filter((f) => !planSet.has(f));
  const optionalTouched = [...optionalSet].filter((f) => created.has(f) || edited.has(f));

  const hasDeviations =
    missingPlannedCreate.length > 0 ||
    missingPlannedEdit.length > 0 ||
    unplannedCreated.length > 0 ||
    unplannedEdited.length > 0 ||
    deleted.length > 0 ||
    renames.length > 0;

  return {
    createdAsPlanned,
    editedAsPlanned,
    missingPlannedCreate,
    missingPlannedEdit,
    unplannedCreated,
    unplannedEdited,
    optionalTouched,
    deletions: deleted,
    renames,
    hasDeviations,
  };
}
