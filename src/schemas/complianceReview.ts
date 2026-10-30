// The `compliance-review` document: `<run folder>/compliance-review.json`, the
// compliance review of a run. Since 0.32.0 it is a strict answer: the review
// session's answer and the file are one shape, `$schema` const first, then the
// verdict, the summary, one verdict per phase, the two ledgers, the attention
// points and the pointers. The 0.17.0 shape (no ledgers) and the pre-schema one
// stay readable through src/schemas/history/compliance-review/.
import { Either, Schema, type Types } from "effect";
import { answerSchemaUrlField } from "./answerStamp.js";
import { formatAnswerViolations } from "./formatError.js";
import { CURRENT_STAMPS } from "./release.js";
import { schemaUrl } from "./schemaUrl.js";
import { NonEmptyString } from "./strictString.js";

export const VerdictSchema = Schema.Literal(
  "conformant",
  "conformant-with-deviations",
  "divergent",
);
export type Verdict = Schema.Schema.Type<typeof VerdictSchema>;

export const SeveritySchema = Schema.Literal("info", "deviation", "concern");
export type Severity = Schema.Schema.Type<typeof SeveritySchema>;

export const DimensionSchema = Schema.Literal(
  "objective",
  "excluded-scope",
  "files",
  "tests",
  "boundaries",
  "commit",
  "handoff",
);
export type Dimension = Schema.Schema.Type<typeof DimensionSchema>;

export const FindingSchema = Schema.Struct({
  dimension: DimensionSchema,
  severity: SeveritySchema,
  message: Schema.String,
});
export type Finding = Schema.Schema.Type<typeof FindingSchema>;

export const PhaseVerdictSchema = Schema.Struct({
  phaseId: NonEmptyString,
  verdict: VerdictSchema,
  findings: Schema.Array(FindingSchema),
});
export type PhaseVerdict = Schema.Schema.Type<typeof PhaseVerdictSchema>;

export const UnplannedChangeSchema = Schema.Struct({
  phaseId: NonEmptyString,
  path: NonEmptyString,
  note: NonEmptyString,
});
export type UnplannedChange = Schema.Schema.Type<typeof UnplannedChangeSchema>;

export const UnmetPromiseSchema = Schema.Struct({
  phaseId: NonEmptyString,
  promise: NonEmptyString,
  note: NonEmptyString,
});
export type UnmetPromise = Schema.Schema.Type<typeof UnmetPromiseSchema>;

const complianceReviewFields = {
  verdict: VerdictSchema,
  summary: Schema.String,
  perPhase: Schema.Array(PhaseVerdictSchema),
  unplannedChanges: Schema.Array(UnplannedChangeSchema).annotations({
    description:
      "Every change the plan did not call for: the phase that made it, the path, and a note. An empty list says there was none.",
  }),
  unmetPromises: Schema.Array(UnmetPromiseSchema).annotations({
    description:
      "Every promise of the plan a phase did not keep: the phase, the promise, and a note. An empty list says there was none.",
  }),
  attentionPoints: Schema.Array(Schema.String),
  pointers: Schema.Array(Schema.String),
};

/** A compliance review in memory: never a `$schema`. */
export type ComplianceReview = Types.Simplify<Schema.Struct.Type<typeof complianceReviewFields>>;

/**
 * A compliance review that may predate the ledgers: the fields every shape
 * carries. A 0.17.0 or pre-schema file has neither ledger.
 */
export type AnyShapeComplianceReview = Omit<ComplianceReview, "unplannedChanges" | "unmetPromises">;

/**
 * A `compliance-review` document, which is also the answer the review session
 * gives: `$schema` first, then the review. Every key is required; any other
 * key is refused, at any level.
 */
export const ComplianceReviewFileSchema = Schema.Struct({
  $schema: answerSchemaUrlField("compliance-review"),
  ...complianceReviewFields,
});

export type ComplianceReviewFile = Schema.Schema.Type<typeof ComplianceReviewFileSchema>;

export const decodeComplianceReviewFile = Schema.decodeUnknownEither(ComplianceReviewFileSchema, {
  onExcessProperty: "error",
});

const decodeComplianceReviewAnswerAll = Schema.decodeUnknownEither(ComplianceReviewFileSchema, {
  errors: "all",
  onExcessProperty: "error",
});

export const encodeComplianceReviewFile = Schema.encodeSync(ComplianceReviewFileSchema);

/**
 * Reads the session's parsed answer, which is the file's own shape: one that
 * does not meet it is a Left with the refusal text (every root-level issue,
 * `$schema` first, joined by `; `; else the first violation); otherwise the
 * review, without `$schema`. Reading the final text as JSON is the caller's.
 */
export function readComplianceReviewAnswer(
  parsed: unknown,
): Either.Either<ComplianceReview, string> {
  const decoded = decodeComplianceReviewAnswerAll(parsed);
  if (Either.isLeft(decoded)) return Either.left(formatAnswerViolations(decoded.left));
  const { $schema: _schema, ...review } = decoded.right;
  return Either.right(review);
}

/** The text of `compliance-review.json`: `$schema` first, then the review, indented by 2. */
export function complianceReviewFileText(review: ComplianceReview): string {
  const file = encodeComplianceReviewFile({
    $schema: schemaUrl("compliance-review", CURRENT_STAMPS["compliance-review"]),
    ...review,
  });
  return JSON.stringify(file, null, 2);
}
