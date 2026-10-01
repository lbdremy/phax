import { Schema } from "effect";

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
 * `file-reconciliation.json` as phax writes it: today's schema until the file
 * gains `$schema`.
 * @alias
 */
export const PhaseFileReconciliationFileSchema = PhaseFileReconciliationSchema;

export const decodePhaseFileReconciliationFile = Schema.decodeUnknownEither(
  PhaseFileReconciliationFileSchema,
);
export const encodePhaseFileReconciliation = Schema.encodeSync(PhaseFileReconciliationSchema);
