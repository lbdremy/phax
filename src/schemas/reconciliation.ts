import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

export const PhaseFileReconciliationSchema = Schema.Struct({
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

export type PhaseFileReconciliation = Schema.Schema.Type<typeof PhaseFileReconciliationSchema>;

/**
 * `file-reconciliation.json` as phax writes it: `$schema` first, then the
 * reconciliation's fields. Unknown keys are ignored.
 */
export const PhaseFileReconciliationFileSchema = Schema.Struct({
  $schema: schemaUrlField("phase-file-reconciliation"),
  ...PhaseFileReconciliationSchema.fields,
});

export type PhaseFileReconciliationFile = Schema.Schema.Type<
  typeof PhaseFileReconciliationFileSchema
>;

export const decodePhaseFileReconciliationFile = Schema.decodeUnknownEither(
  PhaseFileReconciliationFileSchema,
);
export const encodePhaseFileReconciliationFile = Schema.encodeSync(
  PhaseFileReconciliationFileSchema,
);
// The in-memory reconciliation, without `$schema`: the pre-schema file shape.
export const encodePhaseFileReconciliation = Schema.encodeSync(PhaseFileReconciliationSchema);
