// The frozen pre-schema shape of `plan-document`: exactly what phax wrote
// before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
import { Schema } from "effect";

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

export const PlanDocumentPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("plan"),
  sourceSpec: Schema.NullOr(Schema.NonEmptyString),
  run: ExtractedRunSchema,
  preamble: Schema.Struct({
    summary: Schema.NonEmptyString,
    requiredCommandsNote: Schema.NonEmptyString,
    technicalArbitrations: Schema.Array(Schema.NonEmptyString),
  }),
  phases: Schema.NonEmptyArray(PlanDocumentPhaseSchema),
}).annotations({ title: "phax plan document (experimental)" });

export type PlanDocumentPreSchema = Schema.Schema.Type<typeof PlanDocumentPreSchemaSchema>;

export const decodePlanDocumentPreSchema = Schema.decodeUnknownEither(PlanDocumentPreSchemaSchema, {
  onExcessProperty: "error",
});
