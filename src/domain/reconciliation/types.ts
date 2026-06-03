export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface NameStatusEntry {
  readonly status: ChangeStatus;
  readonly path: string;
  readonly oldPath?: string;
}

export interface PlannedFiles {
  readonly create: readonly string[];
  readonly edit: readonly string[];
  readonly optional: readonly string[];
}

export interface ReconciliationResult {
  readonly createdAsPlanned: readonly string[];
  readonly editedAsPlanned: readonly string[];
  readonly missingPlannedCreate: readonly string[];
  readonly missingPlannedEdit: readonly string[];
  readonly unplannedCreated: readonly string[];
  readonly unplannedEdited: readonly string[];
  readonly optionalTouched: readonly string[];
  readonly deletions: readonly string[];
  readonly renames: readonly { from: string; to: string }[];
  readonly hasDeviations: boolean;
}
