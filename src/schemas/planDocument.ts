import { Array as Arr, JSONSchema, Schema, type Types } from "effect";
import { ExtractedPhaseFields, ExtractedRunSchema, type ExtractedPhaxPlan } from "./phaxPlan.js";
import { schemaUrlField } from "./schemaUrl.js";

// The plan document: the JSON a headless plan authoring session returns. Its
// projection (`projectExtractedPlan`) is exactly the extracted-plan shape, built
// from the same field schemas the extractor's output is decoded with; the rest is
// the informational content a rendered plan.md needs. Experimental — outside the
// `version: 1` stability promise. Every field is required.

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
  run: ExtractedRunSchema,
  preamble: Schema.Struct({
    summary: Schema.NonEmptyString,
    requiredCommandsNote: Schema.NonEmptyString,
    technicalArbitrations: Schema.Array(Schema.NonEmptyString),
  }),
  phases: Schema.NonEmptyArray(PlanDocumentPhaseSchema),
};

export const PlanDocumentSchema = Schema.Struct({
  version: Schema.Literal(1),
  ...planDocumentFields,
}).annotations({ title: "phax plan document (experimental)" });

/** The document an authoring session returns: `version: 1`, then the plan. */
export type AuthoredPlanDocument = Schema.Schema.Type<typeof PlanDocumentSchema>;
/** A plan document in memory: never a `version`, never a `$schema`. */
export type PlanDocument = Types.Simplify<Schema.Struct.Type<typeof planDocumentFields>>;
export type PlanDocumentPhase = Schema.Schema.Type<typeof PlanDocumentPhaseSchema>;

// The document an authoring session returns: decoded with this contract, never through the bridge.
export const decodePlanDocument = Schema.decodeUnknownEither(PlanDocumentSchema, {
  onExcessProperty: "error",
});

/**
 * A plan's JSON sidecar as phax persists it: `$schema` first, then the
 * document's fields. Unknown keys are rejected.
 */
export const PlanDocumentFileSchema = Schema.Struct({
  $schema: schemaUrlField("plan-document"),
  ...planDocumentFields,
});

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
