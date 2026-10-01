// The frozen pre-schema shape of `phase-file-reconciliation`: exactly what
// phax wrote before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
import { Schema } from "effect";

export const PhaseFileReconciliationPreSchemaSchema = Schema.Struct({
  phaseId: Schema.NonEmptyString,
  createdAsPlanned: Schema.Array(Schema.String),
  editedAsPlanned: Schema.Array(Schema.String),
  missingPlannedCreate: Schema.Array(Schema.String),
  missingPlannedEdit: Schema.Array(Schema.String),
  createdButPlannedEdit: Schema.Array(Schema.String),
  editedButPlannedCreate: Schema.Array(Schema.String),
  unplannedCreated: Schema.Array(Schema.String),
  unplannedEdited: Schema.Array(Schema.String),
  optionalTouched: Schema.Array(Schema.String),
  deletions: Schema.Array(Schema.String),
  renames: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String })),
  hasDeviations: Schema.Boolean,
});

export type PhaseFileReconciliationPreSchema = Schema.Schema.Type<
  typeof PhaseFileReconciliationPreSchemaSchema
>;

export const decodePhaseFileReconciliationPreSchema = Schema.decodeUnknownEither(
  PhaseFileReconciliationPreSchemaSchema,
);
