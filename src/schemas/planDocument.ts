import { Array as Arr, JSONSchema, Schema, type Types } from "effect";
import { ExtractedPhaseFields, ExtractedRunSchema, type ExtractedPhaxPlan } from "./phaxPlan.js";
import { schemaUrlField } from "./schemaUrl.js";

// The plan document: the JSON a headless plan authoring session returns. Its
// projection (`projectExtractedPlan`) is exactly the extracted-plan shape, built
// from the same field schemas the extractor's output is decoded with; the rest is
// the informational content a rendered plan.md needs. Experimental — outside the
// `version: 1` stability promise. Every field is required. The lineage
// (`sourceSpec`, `completesSpec`) mirrors the rendered frontmatter and stays
// out of the projection: `phax-plan.json` carries no lineage.

const PlanDocumentPhaseSchema = Schema.Struct({
  ...ExtractedPhaseFields,
  title: Schema.NonEmptyString,
  objective: Schema.NonEmptyString,
  detailedInstructions: Schema.Array(Schema.NonEmptyString),
  // Null for a phase that crosses no boundary: the phax-planning skill omits the
  // section rather than filling it.
  boundaryContracts: Schema.NullOr(Schema.NonEmptyString),
  testStrategy: Schema.NonEmptyString,
  implementationOrder: Schema.Array(Schema.NonEmptyString),
  excludedScope: Schema.Array(Schema.NonEmptyString),
  verification: Schema.NonEmptyString,
  expectedHandoff: Schema.NonEmptyString,
});

const planDocumentFields = {
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
};

/**
 * A plan's lineage, one legal form per variant: a source spec and whether this
 * plan completes it, or neither.
 */
export type PlanDocumentLineage =
  | { readonly sourceSpec: string; readonly completesSpec: boolean }
  | { readonly sourceSpec: null; readonly completesSpec: null };

const LINEAGE_MESSAGE =
  "completesSpec is a boolean beside a sourceSpec path and null beside sourceSpec: null";

function isLineage(doc: {
  readonly sourceSpec: string | null;
  readonly completesSpec: boolean | null;
}): boolean {
  return (doc.sourceSpec === null) === (doc.completesSpec === null);
}

// The struct admits each field's values on their own; this refinement refuses
// the cross pairs (a boolean beside no spec, null beside a spec path). Its
// `oneOf` states the same two legal pairs in the exported JSON Schema; it sits
// inside `allOf` because Effect renders a bare `oneOf` annotation in place of
// the struct instead of beside it.
const lineageFilter = <A extends Parameters<typeof isLineage>[0]>() =>
  Schema.filter((doc: A): doc is A & PlanDocumentLineage => isLineage(doc), {
    message: () => LINEAGE_MESSAGE,
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
  });

const PlanDocumentStruct = Schema.Struct({
  version: Schema.Literal(1),
  ...planDocumentFields,
}).annotations({ title: "phax plan document (experimental)" });

export const PlanDocumentSchema =
  PlanDocumentStruct.pipe(lineageFilter<typeof PlanDocumentStruct.Type>());

/** The document an authoring session returns: `version: 1`, then the plan. */
export type AuthoredPlanDocument = Schema.Schema.Type<typeof PlanDocumentSchema>;
/** A plan document in memory: never a `version`, never a `$schema`. */
export type PlanDocument = Types.Simplify<
  Omit<Schema.Struct.Type<typeof planDocumentFields>, keyof PlanDocumentLineage> &
    PlanDocumentLineage
>;
export type PlanDocumentPhase = Schema.Schema.Type<typeof PlanDocumentPhaseSchema>;

// The document an authoring session returns: decoded with this contract, never through the bridge.
export const decodePlanDocument = Schema.decodeUnknownEither(PlanDocumentSchema, {
  onExcessProperty: "error",
});

const PlanDocumentFileStruct = Schema.Struct({
  $schema: schemaUrlField("plan-document"),
  ...planDocumentFields,
});

/**
 * A plan's JSON sidecar as phax persists it: `$schema` first, then the
 * document's fields, with the same lineage check. Unknown keys are rejected.
 */
export const PlanDocumentFileSchema =
  PlanDocumentFileStruct.pipe(lineageFilter<typeof PlanDocumentFileStruct.Type>());

export type PlanDocumentFile = Schema.Schema.Type<typeof PlanDocumentFileSchema>;

export const decodePlanDocumentFile = Schema.decodeUnknownEither(PlanDocumentFileSchema, {
  onExcessProperty: "error",
});
export const encodePlanDocumentFile = Schema.encodeSync(PlanDocumentFileSchema);

export function getPlanDocumentJsonSchema(): object {
  return JSONSchema.make(PlanDocumentSchema);
}

// The extracted-plan projection: the fields `phax run` reads, and nothing else —
// not the phase `title` (derived from the rendered heading, as for any plan.md)
// nor any informational field. Built key by key so an informational field can
// never leak into the cache seed.
export function projectExtractedPlan(doc: AuthoredPlanDocument): ExtractedPhaxPlan {
  return {
    version: doc.version,
    run: {
      shortName: doc.run.shortName,
      title: doc.run.title,
      requiredCommands: doc.run.requiredCommands,
    },
    phases: Arr.map(doc.phases, (phase) => ({
      id: phase.id,
      model: phase.model,
      effort: phase.effort,
      planMarkdownAnchor: phase.planMarkdownAnchor,
      plannedFilesToCreate: phase.plannedFilesToCreate,
      plannedFilesToEdit: phase.plannedFilesToEdit,
      optionalFilesToEdit: phase.optionalFilesToEdit,
      commit: { subject: phase.commit.subject, body: phase.commit.body },
    })),
  };
}
