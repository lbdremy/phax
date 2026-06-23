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
  // planned-to-edit but actually created (action mismatch, file was still delivered)
  const createdButPlannedEdit = planned.edit.filter((f) => created.has(f) && !edited.has(f));
  const createdButPlannedEditSet = new Set(createdButPlannedEdit);
  const editedAsPlanned = planned.edit.filter((f) => edited.has(f));
  // planned-to-create but actually modified (action mismatch, file was still delivered)
  const editedButPlannedCreate = planned.create.filter((f) => edited.has(f) && !created.has(f));
  const editedButPlannedCreateSet = new Set(editedButPlannedCreate);

  // truly untouched: neither the expected action nor the other action was applied
  const missingPlannedCreate = planned.create.filter(
    (f) => !created.has(f) && !editedButPlannedCreateSet.has(f),
  );
  const missingPlannedEdit = planned.edit.filter(
    (f) => !edited.has(f) && !createdButPlannedEditSet.has(f),
  );

  const unplannedCreated = [...created].filter((f) => !planSet.has(f));
  const unplannedEdited = [...edited].filter((f) => !planSet.has(f));
  const optionalTouched = [...optionalSet].filter((f) => created.has(f) || edited.has(f));

  // action mismatches are informational and do not set hasDeviations
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
    createdButPlannedEdit,
    editedButPlannedCreate,
    unplannedCreated,
    unplannedEdited,
    optionalTouched,
    deletions: deleted,
    renames,
    hasDeviations,
  };
}
