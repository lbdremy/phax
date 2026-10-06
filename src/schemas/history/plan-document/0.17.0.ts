// The frozen 0.17.0 shape of `plan-document`: the sidecar phax 0.17.0 through
// 0.19.x wrote, `$schema` first and no `completesSpec`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. phax itself never imports
// it; the schemas package lists it as the format's 0.17.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/plan-document\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The plan-document format and the phax release that wrote this file: https://docs.phax.run/schemas/plan-document/<X.Y.Z>.json",
  }),
);

const EffortSchema = Schema.Literal(
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultra",
);

const ExtractedPhaseFields = {
  id: Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/)),
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  planMarkdownAnchor: Schema.NonEmptyString,
  plannedFilesToCreate: Schema.Array(Schema.String),
  plannedFilesToEdit: Schema.Array(Schema.String),
  optionalFilesToEdit: Schema.Array(Schema.String),
  commit: Schema.Struct({
    subject: Schema.NonEmptyString,
    body: Schema.NonEmptyString,
  }),
};

const ExtractedRunSchema = Schema.Struct({
  shortName: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  requiredCommands: Schema.Array(Schema.String),
});

const PlanDocumentPhaseSchema = Schema.Struct({
  ...ExtractedPhaseFields,
  title: Schema.NonEmptyString,
  objective: Schema.NonEmptyString,
  detailedInstructions: Schema.Array(Schema.NonEmptyString),
  boundaryContracts: Schema.NullOr(Schema.NonEmptyString),
  testStrategy: Schema.NonEmptyString,
  implementationOrder: Schema.Array(Schema.NonEmptyString),
  excludedScope: Schema.Array(Schema.NonEmptyString),
  verification: Schema.NonEmptyString,
  expectedHandoff: Schema.NonEmptyString,
});

export const PlanDocumentV0_17_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  kind: Schema.Literal("plan"),
  sourceSpec: Schema.NullOr(Schema.NonEmptyString),
  run: ExtractedRunSchema,
  preamble: Schema.Struct({
    summary: Schema.NonEmptyString,
    requiredCommandsNote: Schema.NonEmptyString,
    technicalArbitrations: Schema.Array(Schema.NonEmptyString),
  }),
  phases: Schema.NonEmptyArray(PlanDocumentPhaseSchema),
});

export type PlanDocumentV0_17_0 = Schema.Schema.Type<typeof PlanDocumentV0_17_0Schema>;

export const decodePlanDocumentV0_17_0 = Schema.decodeUnknownEither(PlanDocumentV0_17_0Schema, {
  onExcessProperty: "error",
});
