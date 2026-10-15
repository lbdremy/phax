// The frozen 0.20.0 shape of `plan-document`: the sidecar phax 0.20.0 through
// 0.24.x wrote, `$schema` first, with `completesSpec` and no questions in its
// preamble. Never edit this module: packages/schemas/history.lock.json pins
// its bytes. In phax, only src/schemas/persisted.ts may import it. The schemas
// package lists it as the format's 0.20.0 release.
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

const PlanDocumentStruct = Schema.Struct({
  $schema: SchemaUrlSchema,
  kind: Schema.Literal("plan"),
  sourceSpec: Schema.NullOr(Schema.NonEmptyString),
  completesSpec: Schema.NullOr(Schema.Boolean).annotations({
    description:
      "Whether this plan's run completes its source spec: true when it is the spec's last plan, false when more plans of the spec follow. A boolean beside a sourceSpec path; null beside sourceSpec: null.",
  }),
  run: ExtractedRunSchema,
  preamble: Schema.Struct({
    summary: Schema.NonEmptyString,
    requiredCommandsNote: Schema.NonEmptyString,
    technicalArbitrations: Schema.Array(Schema.NonEmptyString),
  }),
  phases: Schema.NonEmptyArray(PlanDocumentPhaseSchema),
});

type PlanDocumentStructType = Schema.Schema.Type<typeof PlanDocumentStruct>;

/** A plan's lineage, one legal form per variant. */
type PlanDocumentLineage =
  | { readonly sourceSpec: string; readonly completesSpec: boolean }
  | { readonly sourceSpec: null; readonly completesSpec: null };

// The lineage check: a boolean `completesSpec` beside a `sourceSpec` path,
// null beside `sourceSpec: null`.
export const PlanDocumentV0_20_0Schema = PlanDocumentStruct.pipe(
  Schema.filter(
    (doc: PlanDocumentStructType): doc is PlanDocumentStructType & PlanDocumentLineage =>
      (doc.sourceSpec === null) === (doc.completesSpec === null),
    {
      message: () =>
        "completesSpec is a boolean beside a sourceSpec path and null beside sourceSpec: null",
      jsonSchema: {
        allOf: [
          {
            oneOf: [
              {
                properties: {
                  sourceSpec: { type: "string", minLength: 1 },
                  completesSpec: { type: "boolean" },
                },
              },
              { properties: { sourceSpec: { type: "null" }, completesSpec: { type: "null" } } },
            ],
          },
        ],
      },
    },
  ),
);

export type PlanDocumentV0_20_0 = Schema.Schema.Type<typeof PlanDocumentV0_20_0Schema>;

export const decodePlanDocumentV0_20_0 = Schema.decodeUnknownEither(PlanDocumentV0_20_0Schema, {
  onExcessProperty: "error",
});
