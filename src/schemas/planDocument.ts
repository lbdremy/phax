import { Array as Arr, Either, Schema, type Types } from "effect";
import { answerSchemaUrlField } from "./answerStamp.js";
import { formatPlanDocumentViolation, formatViolationAt } from "./formatError.js";
import { ExtractedPhaseFields, ExtractedRunSchema, type ExtractedPhaxPlan } from "./phaxPlan.js";
import {
  OpenQuestionSchema,
  PlanArbitratedQuestionSchema,
  QUESTION_CHECKS_DESCRIPTION,
  authoringArbitratedViolation,
  firstQuestionViolation,
  type OpenQuestion,
  type PlanArbitratedQuestion,
} from "./questions.js";
import { NonEmptyString } from "./strictString.js";
import { TestLineSchema } from "./testLine.js";

// The plan document: a plan's JSON sidecar, and the JSON a headless plan
// authoring session returns (the same published shape). A strict answer since
// 0.32.0: its `$schema` is a const naming the current stamp and its strings
// are `strictString`'s pattern. Its projection (`projectExtractedPlan`) is
// exactly the extracted-plan shape, built from the same field schemas the
// extractor's output is decoded with; the rest is the informational content a
// rendered plan.md needs. Every field is required. The lineage (`sourceSpec`,
// `completesSpec`) mirrors the rendered frontmatter and stays out of the
// projection: `phax-plan.json` carries no lineage. A phase's
// `assignmentReason` is informational too: rendered, never extracted. A
// phase's `testStrategy` is a list of test lines (src/schemas/testLine.ts),
// rendered in the line format and read back by the test line grammar.

// `assignmentReason`, `model` and `effort` come last, so a headless planner writes
// the phase before it assigns its model.
const PlanDocumentPhaseSchema = Schema.Struct({
  id: ExtractedPhaseFields.id,
  title: NonEmptyString,
  objective: NonEmptyString,
  detailedInstructions: Schema.Array(NonEmptyString),
  planMarkdownAnchor: ExtractedPhaseFields.planMarkdownAnchor,
  plannedFilesToCreate: ExtractedPhaseFields.plannedFilesToCreate,
  plannedFilesToEdit: ExtractedPhaseFields.plannedFilesToEdit,
  optionalFilesToEdit: ExtractedPhaseFields.optionalFilesToEdit,
  mode: ExtractedPhaseFields.mode,
  oracle: ExtractedPhaseFields.oracle,
  // Null for a phase that crosses no boundary: the phax-planning skill omits the
  // section rather than filling it.
  boundaryContracts: Schema.NullOr(NonEmptyString),
  testStrategy: Schema.Array(TestLineSchema).annotations({
    description:
      "The phase's test lines. Each renders as one `- <guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]` line under `### Test strategy`; `[]` is a phase that tests nothing, rendered `- (none)`.",
  }),
  implementationOrder: Schema.Array(NonEmptyString),
  excludedScope: Schema.Array(NonEmptyString),
  verification: NonEmptyString,
  expectedHandoff: NonEmptyString,
  commit: ExtractedPhaseFields.commit,
  assignmentReason: Schema.NullOr(NonEmptyString).annotations({
    description:
      "Why this phase's model and effort depart from the assignment the phax-planning skill gives it; null when they do not. Rendered as an **Assignment reason:** line, never extracted.",
  }),
  model: ExtractedPhaseFields.model,
  effort: ExtractedPhaseFields.effort,
});

const preambleFields = {
  summary: NonEmptyString,
  requiredCommandsNote: NonEmptyString,
  technicalArbitrations: Schema.Array(NonEmptyString),
  openQuestions: Schema.Array(OpenQuestionSchema),
  arbitratedQuestions: Schema.Array(PlanArbitratedQuestionSchema),
};

const planDocumentFields = {
  kind: Schema.Literal("plan"),
  sourceSpec: Schema.NullOr(NonEmptyString),
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
// the cross pairs (a boolean beside no spec, null beside a spec path). The
// pairing is a coherence check phax runs, not a schema construct: a root
// `oneOf` is outside a provider's strict structured output. Its JSON Schema is
// a description only; the root description (`ROOT_DESCRIPTION`) names it.
const lineageFilter = <A extends Parameters<typeof isLineage>[0]>() =>
  Schema.filter((doc: A): doc is A & PlanDocumentLineage => isLineage(doc), {
    message: () => LINEAGE_MESSAGE,
    jsonSchema: { description: ROOT_DESCRIPTION },
  });

interface QuestionBearing {
  readonly preamble: {
    readonly openQuestions: ReadonlyArray<OpenQuestion>;
    readonly arbitratedQuestions: ReadonlyArray<PlanArbitratedQuestion>;
  };
  readonly phases: ReadonlyArray<{ readonly id: string }>;
}

// Every check this module runs that JSON Schema does not express, in one root
// description (Effect keeps only the last root filter's): the lineage pairing,
// the question checks, and an authoring answer's empty arbitrated questions.
const ROOT_DESCRIPTION = `Checked by phax's parser, not by this JSON Schema: ${LINEAGE_MESSAGE}; in the preamble, ${QUESTION_CHECKS_DESCRIPTION}, and a decided verdict's \`phase\` names one of the plan's phases; and an authoring session's answer leaves every question open, so its preamble.arbitratedQuestions is [].`;

// The shared question checks, plus a decided verdict's phase.
function firstPlanQuestionViolation(doc: QuestionBearing) {
  return firstQuestionViolation({
    basePath: ["preamble"],
    openQuestions: doc.preamble.openQuestions,
    arbitratedQuestions: doc.preamble.arbitratedQuestions,
    phaseIds: doc.phases.map((phase) => phase.id),
  });
}

/** A plan document in memory: never a `version`, never a `$schema`. */
export type PlanDocument = Types.Simplify<
  Omit<Schema.Struct.Type<typeof planDocumentFields>, keyof PlanDocumentLineage> &
    PlanDocumentLineage
>;
export type PlanDocumentPhase = Schema.Schema.Type<typeof PlanDocumentPhaseSchema>;

const PlanDocumentFileStruct = Schema.Struct({
  $schema: answerSchemaUrlField("plan-document"),
  ...planDocumentFields,
});

/**
 * A plan's JSON sidecar, which is also the answer a headless authoring session
 * and a decide session give: `$schema` first, then the document's fields, with
 * the lineage and question checks. Unknown keys are rejected.
 */
export const PlanDocumentFileSchema = PlanDocumentFileStruct.pipe(
  lineageFilter<typeof PlanDocumentFileStruct.Type>(),
  Schema.filter(firstPlanQuestionViolation, {
    jsonSchema: { description: ROOT_DESCRIPTION },
  }),
);

export type PlanDocumentFile = Schema.Schema.Type<typeof PlanDocumentFileSchema>;

/** The document an authoring session returns: the sidecar's own shape, `$schema` included. */
export type AuthoredPlanDocument = PlanDocumentFile;

export const decodePlanDocumentFile = Schema.decodeUnknownEither(PlanDocumentFileSchema, {
  onExcessProperty: "error",
});
export const encodePlanDocumentFile = Schema.encodeSync(PlanDocumentFileSchema);

/**
 * Decodes a headless plan authoring session's parsed answer: the authoring
 * rule first (a non-empty `preamble.arbitratedQuestions` is refused at its
 * first entry, `preamble.arbitratedQuestions[0]`), then the sidecar decoder. A
 * Left is the first violation, `<path>: <message>`, a test line's named by its
 * phase and line (`formatPlanDocumentViolation`).
 */
export function decodeAuthoredPlanDocument(
  input: unknown,
): Either.Either<AuthoredPlanDocument, string> {
  const preamble =
    typeof input === "object" && input !== null
      ? (input as { readonly preamble?: unknown }).preamble
      : undefined;
  if (typeof preamble === "object" && preamble !== null) {
    const arbitrated = (preamble as { readonly arbitratedQuestions?: unknown }).arbitratedQuestions;
    if (Array.isArray(arbitrated)) {
      const violation = authoringArbitratedViolation(arbitrated, ["preamble"]);
      if (violation !== undefined) return Either.left(formatViolationAt(violation));
    }
  }
  return Either.mapLeft(decodePlanDocumentFile(input), (error) =>
    formatPlanDocumentViolation(input, error),
  );
}

// The extracted-plan projection: the fields `phax run` reads, and nothing else —
// not the phase `title` (derived from the rendered heading, as for any plan.md)
// nor any informational field. Built key by key so an informational field can
// never leak into the cache seed. The cache's `version: 1` is phax's own.
export function projectExtractedPlan(doc: PlanDocument): ExtractedPhaxPlan {
  return {
    version: 1,
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
      testLines: phase.testStrategy,
      commit: { subject: phase.commit.subject, body: phase.commit.body },
    })),
  };
}
