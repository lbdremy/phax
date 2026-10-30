// The `phax-plan-extraction` format: what the fallback extraction model answers
// when it reads a plan.md the deterministic parser could not (spec
// structured-output). Born at 0.32.0 with `$schema`; phax reads it and never
// writes it. Exactly one of `plan` and `incomplete` is non-null: the plan the
// model extracted, or why it found the plan incomplete. The plan is the
// extracted one without the two things phax reads from plan.md's header lines
// itself (`mode` and `oracle`, see `withPhaseKinds`) and without the cache's
// `version`. Every key is required and any other key is refused. A const
// `$schema` reads only its own stamp: the schemas package still maps a later
// stamp to the latest shape at or below it, so a document stamped above the
// current stamp is refused at `$schema`, and phax never writes one.
import { Either, Schema } from "effect";
import { answerSchemaUrlField } from "./answerStamp.js";
import { formatAnswerViolations } from "./formatError.js";
import { ExtractedRunSchema, answerPhaseFields } from "./phaxPlan.js";
import { NonEmptyString } from "./strictString.js";

const EXACTLY_ONE = "plan and incomplete: exactly one of them is null";

/** The plan the model extracted: its run and phases, a phase without `mode` and `oracle`. */
const ExtractionPlanSchema = Schema.Struct({
  run: ExtractedRunSchema,
  phases: Schema.NonEmptyArray(Schema.Struct(answerPhaseFields)),
});

export type ExtractionPlan = Schema.Schema.Type<typeof ExtractionPlanSchema>;

/**
 * A `phax-plan-extraction` document. `plan` is the extracted plan or null;
 * `incomplete` is what the model found missing, or null. Exactly one is null.
 */
export const PlanExtractionAnswerSchema = Schema.Struct({
  $schema: answerSchemaUrlField("phax-plan-extraction"),
  plan: Schema.NullOr(ExtractionPlanSchema).annotations({
    description: "The extracted plan, or null when the plan is incomplete.",
  }),
  incomplete: Schema.NullOr(NonEmptyString).annotations({
    description:
      "What is missing from the plan, or a test strategy item not in the line format; null when the plan is extracted.",
  }),
}).pipe(
  Schema.filter(
    (answer) => (answer.plan === null) !== (answer.incomplete === null) || EXACTLY_ONE,
    {
      jsonSchema: {},
      description: "Exactly one of plan and incomplete is null.",
    },
  ),
);

export type PlanExtractionAnswer = Schema.Schema.Type<typeof PlanExtractionAnswerSchema>;

/** What the extraction model answered: the plan, or why the plan is incomplete. */
export type PlanExtractionReading =
  | { readonly kind: "plan"; readonly plan: ExtractionPlan }
  | { readonly kind: "incomplete"; readonly reason: string };

export const decodePlanExtractionAnswer = Schema.decodeUnknownEither(PlanExtractionAnswerSchema, {
  onExcessProperty: "error",
});

const decodePlanExtractionAnswerAll = Schema.decodeUnknownEither(PlanExtractionAnswerSchema, {
  errors: "all",
  onExcessProperty: "error",
});

/**
 * Reads the extraction model's parsed answer. One that does not meet the
 * format is a Left with the refusal text: every root-level issue, `$schema`
 * first, joined by `; `, else the first violation. Never throws.
 */
export function readPlanExtractionAnswer(
  parsed: unknown,
): Either.Either<PlanExtractionReading, string> {
  const decoded = decodePlanExtractionAnswerAll(parsed);
  if (Either.isLeft(decoded)) return Either.left(formatAnswerViolations(decoded.left));
  const { plan, incomplete } = decoded.right;
  if (plan !== null) return Either.right({ kind: "plan", plan });
  return Either.right({ kind: "incomplete", reason: incomplete ?? "" });
}
