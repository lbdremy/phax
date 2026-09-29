// Frozen: a phase's file-reconciliation.json as phax has written it, with no
// version literal — shape v0, the union of every signature written:
// - no `phaseId` (src/schemas/reconciliation.ts before 3e952142);
// - no `createdButPlannedEdit` and no `editedButPlannedCreate` (before
//   1bf3e0a2);
// - every field (at bfb8385e).
// Each of the three is optional; every other field is as phax writes it
// today. Unknown keys are ignored, as phax's decoder ignores them.
// Pinned by hash in packages/schemas/history.lock.json — never edit.
// Self-contained: imports only effect, so later changes to phax's
// src/schemas cannot reach it.
import { Schema } from "effect";

export const PhaseFileReconciliationV0Schema = Schema.Struct({
  phaseId: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  createdAsPlanned: Schema.Array(Schema.String),
  editedAsPlanned: Schema.Array(Schema.String),
  missingPlannedCreate: Schema.Array(Schema.String),
  missingPlannedEdit: Schema.Array(Schema.String),
  createdButPlannedEdit: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  editedButPlannedCreate: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  unplannedCreated: Schema.Array(Schema.String),
  unplannedEdited: Schema.Array(Schema.String),
  optionalTouched: Schema.Array(Schema.String),
  deletions: Schema.Array(Schema.String),
  renames: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String })),
  hasDeviations: Schema.Boolean,
});

export type PhaseFileReconciliationV0 = Schema.Schema.Type<typeof PhaseFileReconciliationV0Schema>;

export const decodePhaseFileReconciliationV0 = Schema.decodeUnknownEither(
  PhaseFileReconciliationV0Schema,
);
