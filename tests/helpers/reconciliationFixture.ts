import type { ReconciliationResult } from "../../src/domain/reconciliation/types.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";

/** A reconciliation with nothing in it: no file touched, no deviation, no review correction. */
export function reconciliationResult(
  overrides: Partial<ReconciliationResult> = {},
): ReconciliationResult {
  return {
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
    reviewCorrections: [],
    hasDeviations: false,
    ...overrides,
  };
}

/**
 * A phase's `file-reconciliation.json` as phax writes it: `$schema` at the
 * format's current stamp first, then the phase id and the reconciliation.
 */
export function phaseReconciliationFile(
  phaseId: string,
  overrides: Partial<ReconciliationResult> = {},
) {
  return {
    $schema: currentSchemaUrl("phase-file-reconciliation"),
    phaseId,
    ...reconciliationResult(overrides),
  };
}
