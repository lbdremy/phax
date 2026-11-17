// The `compliance-review` document: `<run folder>/compliance-review.json`, the
// compliance review of a run, and the `compliance-review-answer` the review
// session gives. Two formats (spec finding-ids-and-fates §5.3): a finding of the
// file carries an `id` (`C<n>`, unique across the run's reviews, numbered across
// `perPhase` in document order) that phax gives when it persists the review, and
// a finding of the answer never does. Both strict, `$schema` const first, then the
// verdict, the summary, one verdict per phase, the two ledgers, the attention
// points and the pointers. The 0.32.0 shape (no ids), the 0.17.0 shape (no
// ledgers) and the pre-schema one stay readable through
// src/schemas/history/compliance-review/.
import { Result, Schema, type Types } from "effect";
import { answerSchemaUrlField } from "./answerStamp.js";
import { formatAnswerViolations } from "./formatError.js";
import { CURRENT_STAMPS } from "./release.js";
import { refusalOverride } from "./refusal/adapter.js";
import { schemaUrl } from "./schemaUrl.js";
import { isExportedPattern, NonEmptyString } from "./strictString.js";

export const VerdictSchema = Schema.Literals([
  "conformant",
  "conformant-with-deviations",
  "divergent",
]);
export type Verdict = Schema.Schema.Type<typeof VerdictSchema>;

export const SeveritySchema = Schema.Literals(["info", "deviation", "concern"]);
export type Severity = Schema.Schema.Type<typeof SeveritySchema>;

export const DimensionSchema = Schema.Literals([
  "objective",
  "excluded-scope",
  "files",
  "tests",
  "boundaries",
  "commit",
  "handoff",
]);
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

/**
 * The id of a finding of a compliance review file: `C` and a number from 1,
 * unique across the reviews of a run. phax gives it; a session never writes one.
 */
export const ComplianceFindingIdSchema = Schema.String.check(
  isExportedPattern(/^C[1-9][0-9]*$/),
).annotate({
  description: "The finding's id in its run: C<n>, n from 1, given by phax.",
  ...refusalOverride(
    (actual) => `${JSON.stringify(actual)} is not a compliance finding id (expected C<n>)`,
  ),
});

/** A finding of the file: its id, then what it says. */
const FileFindingSchema = Schema.Struct({
  id: ComplianceFindingIdSchema,
  ...FindingSchema.fields,
});

/** A finding of a persisted compliance review: `id` first, then what it says. */
export type PersistedFinding = Schema.Schema.Type<typeof FileFindingSchema>;

const FilePhaseVerdictSchema = Schema.Struct({
  ...PhaseVerdictSchema.fields,
  findings: Schema.Array(FileFindingSchema),
});

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
  unplannedChanges: Schema.Array(UnplannedChangeSchema).annotate({
    description:
      "Every change the plan did not call for: the phase that made it, the path, and a note. An empty list says there was none.",
  }),
  unmetPromises: Schema.Array(UnmetPromiseSchema).annotate({
    description:
      "Every promise of the plan a phase did not keep: the phase, the promise, and a note. An empty list says there was none.",
  }),
  attentionPoints: Schema.Array(Schema.String),
  pointers: Schema.Array(Schema.String),
};

/** A compliance review in memory, as the session answered it: no ids, never a `$schema`. */
export type ComplianceReview = Types.Simplify<Schema.Struct.Type<typeof complianceReviewFields>>;

/**
 * A compliance review in memory as `compliance-review.json` holds it: every
 * finding has its id.
 */
export type PersistedComplianceReview = Omit<ComplianceReview, "perPhase"> & {
  readonly perPhase: readonly (Omit<PhaseVerdict, "findings"> & {
    readonly findings: readonly PersistedFinding[];
  })[];
};

/**
 * A compliance review that may predate the ledgers or the ids: the fields every
 * shape carries. A 0.17.0 or pre-schema file has neither ledger; a file before
 * 0.40.0 has no finding ids, and a current one has them, so a finding may or
 * may not hold an `id`.
 */
export type AnyShapeComplianceReview = Omit<
  ComplianceReview,
  "unplannedChanges" | "unmetPromises" | "perPhase"
> & {
  readonly perPhase: readonly (Omit<PhaseVerdict, "findings"> & {
    readonly findings: readonly (Finding & { readonly id?: string })[];
  })[];
};

/**
 * A `compliance-review` document: `$schema` first, then the review, each
 * finding with its `id`. Every key is required; any other key is refused, at
 * any level.
 */
export const ComplianceReviewFileSchema = Schema.Struct({
  $schema: answerSchemaUrlField("compliance-review"),
  ...complianceReviewFields,
  perPhase: Schema.Array(FilePhaseVerdictSchema),
});

export type ComplianceReviewFile = Schema.Schema.Type<typeof ComplianceReviewFileSchema>;

export const decodeComplianceReviewFile = Schema.decodeUnknownResult(ComplianceReviewFileSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

/**
 * The answer the review session gives: `$schema` first, then the review.
 * Every key is required; any other key, an `id` on a finding included, is
 * refused, at any level.
 */
export const ComplianceReviewAnswerSchema = Schema.Struct({
  $schema: answerSchemaUrlField("compliance-review-answer"),
  ...complianceReviewFields,
});

export type ComplianceReviewAnswer = Schema.Schema.Type<typeof ComplianceReviewAnswerSchema>;

export const decodeComplianceReviewAnswer = Schema.decodeUnknownResult(
  ComplianceReviewAnswerSchema,
  {
    errors: "all",
    onExcessProperty: "error",
    reportInput: true,
  },
);

export const encodeComplianceReviewFile = Schema.encodeSync(ComplianceReviewFileSchema);

/**
 * Reads the session's parsed answer, a `compliance-review-answer`: one that
 * does not meet it is a Left with the refusal text (every root-level issue,
 * `$schema` first, joined by `; `; else the first violation); otherwise the
 * review, without `$schema`. Reading the final text as JSON is the caller's.
 */
export function readComplianceReviewAnswer(
  parsed: unknown,
): Result.Result<ComplianceReview, string> {
  const decoded = decodeComplianceReviewAnswer(parsed);
  if (Result.isFailure(decoded))
    return Result.fail(formatAnswerViolations(parsed, decoded.failure));
  const { $schema: _schema, ...review } = decoded.success;
  return Result.succeed(review);
}

/** The text of `compliance-review.json`: `$schema` first, then the review with its finding ids, indented by 2. */
export function complianceReviewFileText(review: PersistedComplianceReview): string {
  const file = encodeComplianceReviewFile({
    $schema: schemaUrl("compliance-review", CURRENT_STAMPS["compliance-review"]),
    ...review,
  });
  return JSON.stringify(file, null, 2);
}
