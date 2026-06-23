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

export const decodePhaseFileReconciliation = Schema.decodeUnknownEither(
  PhaseFileReconciliationSchema,
);
export const encodePhaseFileReconciliation = Schema.encodeSync(PhaseFileReconciliationSchema);
