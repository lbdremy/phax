// The frozen 0.17.0 shape of `phase-file-reconciliation`: the
// file-reconciliation.json phax 0.17.0 through 0.25.x wrote, `$schema` first
// and no `reviewCorrections`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it; the schemas package lists it as the
// format's 0.17.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/phase-file-reconciliation\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The phase-file-reconciliation format and the phax release that wrote this file: https://docs.phax.run/schemas/phase-file-reconciliation/<X.Y.Z>.json",
  }),
);

export const PhaseFileReconciliationV0_17_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
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

export type PhaseFileReconciliationV0_17_0 = Schema.Schema.Type<
  typeof PhaseFileReconciliationV0_17_0Schema
>;

export const decodePhaseFileReconciliationV0_17_0 = Schema.decodeUnknownEither(
  PhaseFileReconciliationV0_17_0Schema,
);
