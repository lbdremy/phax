import { Array as Arr, JSONSchema, Schema, type Types } from "effect";
import { ExtractedPhaseFields, ExtractedRunSchema, type ExtractedPhaxPlan } from "./phaxPlan.js";
import {
  OpenQuestionSchema,
  PlanArbitratedQuestionSchema,
  PlanAuthoringArbitratedQuestionsSchema,
  QUESTION_CHECKS_DESCRIPTION,
  firstQuestionViolation,
  type OpenQuestion,
  type PlanArbitratedQuestion,
} from "./questions.js";
import { schemaUrlField } from "./schemaUrl.js";

// The plan document: the JSON a headless plan authoring session returns. Its
// projection (`projectExtractedPlan`) is exactly the extracted-plan shape, built
// from the same field schemas the extractor's output is decoded with; the rest is
// the informational content a rendered plan.md needs. Experimental — outside the
// `version: 1` stability promise. Every field is required. The lineage
// (`sourceSpec`, `completesSpec`) mirrors the rendered frontmatter and stays
// out of the projection: `phax-plan.json` carries no lineage. A phase's
// `assignmentReason` is informational too: rendered, never extracted.

// `assignmentReason`, `model` and `effort` come last, so a headless planner writes
// the phase before it assigns its model.
const PlanDocumentPhaseSchema = Schema.Struct({
  id: ExtractedPhaseFields.id,
  title: Schema.NonEmptyString,
  objective: Schema.NonEmptyString,
  detailedInstructions: Schema.Array(Schema.NonEmptyString),
  planMarkdownAnchor: ExtractedPhaseFields.planMarkdownAnchor,
  plannedFilesToCreate: ExtractedPhaseFields.plannedFilesToCreate,
  plannedFilesToEdit: ExtractedPhaseFields.plannedFilesToEdit,
  optionalFilesToEdit: ExtractedPhaseFields.optionalFilesToEdit,
  mode: ExtractedPhaseFields.mode,
  oracle: ExtractedPhaseFields.oracle,
  // Null for a phase that crosses no boundary: the phax-planning skill omits the
  // section rather than filling it.
  boundaryContracts: Schema.NullOr(Schema.NonEmptyString),
  testStrategy: Schema.NonEmptyString,
  implementationOrder: Schema.Array(Schema.NonEmptyString),
  excludedScope: Schema.Array(Schema.NonEmptyString),
  verification: Schema.NonEmptyString,
  expectedHandoff: Schema.NonEmptyString,
  commit: ExtractedPhaseFields.commit,
  assignmentReason: Schema.NullOr(Schema.NonEmptyString).annotations({
    description:
      "Why this phase's model and effort depart from the assignment the phax-planning skill gives it; null when they do not. Rendered as an **Assignment reason:** line, never extracted.",
  }),
  model: ExtractedPhaseFields.model,
  effort: ExtractedPhaseFields.effort,
});

const preambleFields = {
  summary: Schema.NonEmptyString,
  requiredCommandsNote: Schema.NonEmptyString,
  technicalArbitrations: Schema.Array(Schema.NonEmptyString),
  openQuestions: Schema.Array(OpenQuestionSchema),
  arbitratedQuestions: Schema.Array(PlanArbitratedQuestionSchema),
};

const planDocumentFields = {
  kind: Schema.Literal("plan"),
  sourceSpec: Schema.NullOr(Schema.NonEmptyString),
  completesSpec: Schema.NullOr(Schema.Boolean).annotations({
    description:
      "Whether this plan's run completes its source spec: true when it is the spec's last plan, false when more plans of the spec follow. A boolean beside a sourceSpec path; null beside sourceSpec: null.",
  }),
  run: ExtractedRunSchema,
  preamble: Schema.Struct(preambleFields),
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

interface QuestionBearing {
  readonly preamble: {
    readonly openQuestions: ReadonlyArray<OpenQuestion>;
    readonly arbitratedQuestions: ReadonlyArray<PlanArbitratedQuestion>;
  };
  readonly phases: ReadonlyArray<{ readonly id: string }>;
}

// The shared question checks, plus a decided verdict's phase.
function firstPlanQuestionViolation(doc: QuestionBearing) {
  return firstQuestionViolation({
    basePath: ["preamble"],
    openQuestions: doc.preamble.openQuestions,
    arbitratedQuestions: doc.preamble.arbitratedQuestions,
    phaseIds: doc.phases.map((phase) => phase.id),
  });
}

// JSON Schema cannot express the question checks: the annotation declares the
// gap in the exported schema rather than dropping the filter silently.
const QUESTIONS_FILTER_OPTIONS = {
  jsonSchema: {
    description: `Checked by phax's parser, not by this JSON Schema, in the preamble: ${QUESTION_CHECKS_DESCRIPTION}; and a decided verdict's \`phase\` names one of the plan's phases.`,
  },
};

// The authoring answer leaves every question open (§5.60): its
// `preamble.arbitratedQuestions` is always empty, and a non-empty one is
// refused at its first entry, through the invalid-document path. Its
// `preamble.openQuestions` is accepted.
const PlanDocumentStruct = Schema.Struct({
  version: Schema.Literal(1),
  ...planDocumentFields,
  preamble: Schema.Struct({
    ...preambleFields,
    arbitratedQuestions: PlanAuthoringArbitratedQuestionsSchema,
  }),
}).annotations({ title: "phax plan document (experimental)" });

export const PlanDocumentSchema = PlanDocumentStruct.pipe(
  lineageFilter<typeof PlanDocumentStruct.Type>(),
  Schema.filter(firstPlanQuestionViolation, QUESTIONS_FILTER_OPTIONS),
);

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
 * document's fields, with the same lineage and question checks. Unlike the
 * authoring answer, it carries arbitrated questions. Unknown keys are rejected.
 */
export const PlanDocumentFileSchema = PlanDocumentFileStruct.pipe(
  lineageFilter<typeof PlanDocumentFileStruct.Type>(),
  Schema.filter(firstPlanQuestionViolation, QUESTIONS_FILTER_OPTIONS),
);

export type PlanDocumentFile = Schema.Schema.Type<typeof PlanDocumentFileSchema>;

export const decodePlanDocumentFile = Schema.decodeUnknownEither(PlanDocumentFileSchema, {
  onExcessProperty: "error",
});
export const encodePlanDocumentFile = Schema.encodeSync(PlanDocumentFileSchema);

export function getPlanDocumentJsonSchema(): object {
  return JSONSchema.make(PlanDocumentSchema);
}

/** The JSON Schema of a plan sidecar: what a decide session returns as its revised document. */
export function getPlanDocumentFileJsonSchema(): object {
  return JSONSchema.make(PlanDocumentFileSchema);
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
      mode: phase.mode,
      oracle: phase.oracle,
      commit: { subject: phase.commit.subject, body: phase.commit.body },
    })),
  };
}
