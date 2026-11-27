// The `code-review` document: `<run folder>/code-review.json`, the findings of
// the headless code review of spec headless-code-review, and the
// `code-review-answer` the session gives as its final message. The two are
// formats of their own (spec finding-ids-and-fates §5.2): a finding of the file
// carries an `id` (`F<n>`, unique across the run's reviews) that phax gives
// when it persists the review, and a finding of the answer never does. Both are
// strict (the `$schema` const and `strictString`'s pattern). Born with
// `$schema`. The closed severity, lens and escape ids are the ones the bundled
// `phax-review` skill lists; a test keeps the two equal. The 0.32.0 file (no
// ids) stays readable through src/schemas/history/code-review/.
import { Result, Schema } from "effect";
import { answerSchemaUrlField } from "./answerStamp.js";
import { formatAnswerViolations } from "./formatError.js";
import { CURRENT_STAMPS } from "./release.js";
import { refusalLabel, refusalOverride } from "./refusal/adapter.js";
import { schemaUrl } from "./schemaUrl.js";
import { isExportedPattern, NonEmptyString } from "./strictString.js";

// A value outside a closed set names itself and the set: `"security" is not a
// lens (expected one of surface, acceptance, …)`.
// The literal union reports its first member otherwise, hence the override.
const notOneOf = (noun: string, ids: readonly string[]) =>
  refusalOverride(
    (actual) => `${JSON.stringify(actual)} is not ${noun} (expected one of ${ids.join(", ")})`,
  );

const SEVERITY_IDS = ["bug", "deviation", "concern", "info"] as const;
const LENS_IDS = [
  "surface",
  "acceptance",
  "boundary",
  "core",
  "edge",
  "tests",
  "architecture",
  "docs",
] as const;
const ESCAPE_IDS = [
  "wrong-oracle",
  "same-author",
  "weakened",
  "fake-drift",
  "unexplored-input",
  "omission",
  "untestable",
] as const;

export const CodeReviewSeveritySchema = Schema.Literals(SEVERITY_IDS).annotate(
  notOneOf("a severity", SEVERITY_IDS),
);

export const CodeReviewLensSchema = Schema.Literals(LENS_IDS).annotate(
  notOneOf("a lens", LENS_IDS),
);

export const CodeReviewEscapeSchema = Schema.Literals(ESCAPE_IDS).annotate(
  notOneOf("an escape", ESCAPE_IDS),
);

export const CODE_REVIEW_SEVERITIES = CodeReviewSeveritySchema.literals;
export const CODE_REVIEW_LENSES = CodeReviewLensSchema.literals;
export const CODE_REVIEW_ESCAPES = CodeReviewEscapeSchema.literals;

export const CODE_REVIEW_JSON_FILENAME = "code-review.json";

// What a finding says, with no id: the answer's finding, and the file's after
// its `id`.
const codeReviewFindingFields = {
  severity: CodeReviewSeveritySchema,
  file: NonEmptyString.annotate({
    description: "The path the finding is about, as the reviewer gave it.",
  }),
  line: Schema.Int.check(Schema.isGreaterThan(0)).annotate({
    description: "The 1-based line the finding is about.",
    ...refusalOverride((actual) => `must be a positive integer, actual ${JSON.stringify(actual)}`),
  }),
  message: NonEmptyString,
  lens: CodeReviewLensSchema,
  escape: CodeReviewEscapeSchema,
  criterion: Schema.NullOr(NonEmptyString).annotate({
    description: "The acceptance criterion id the finding is about, or null.",
  }),
  suggestion: NonEmptyString,
};

const CodeReviewFindingSchema = Schema.Struct(codeReviewFindingFields);

export type CodeReviewFinding = Schema.Schema.Type<typeof CodeReviewFindingSchema>;

/**
 * The id of a finding of a code review file: `F` and a number from 1, unique
 * across the reviews of a run. phax gives it; a session never writes one.
 */
export const CodeReviewFindingIdSchema = Schema.String.check(
  isExportedPattern(/^F[1-9][0-9]*$/, refusalLabel("FindingId")),
).annotate({
  description: "The finding's id in its run: F<n>, n from 1, given by phax.",
  ...refusalOverride(
    (actual) => `${JSON.stringify(actual)} is not a code review finding id (expected F<n>)`,
  ),
});

/** A finding of the file: its id, then what it says. */
const CodeReviewFileFindingSchema = Schema.Struct({
  id: CodeReviewFindingIdSchema,
  ...codeReviewFindingFields,
});

/** A finding of a persisted code review: `id` first, then what it says. */
export type PersistedCodeReviewFinding = Schema.Schema.Type<typeof CodeReviewFileFindingSchema>;

/** A code review in memory, as the session answered it: no id, never a `$schema`. */
export interface CodeReview {
  readonly findings: readonly CodeReviewFinding[];
}

/** A code review in memory as `code-review.json` holds it: every finding has its id. */
export interface PersistedCodeReview {
  readonly findings: readonly PersistedCodeReviewFinding[];
}

/**
 * A `code-review` document: `$schema` first, then the findings, each with its
 * `id`. Every key is required; any other key is refused, at any level.
 */
export const CodeReviewFileSchema = Schema.Struct({
  $schema: answerSchemaUrlField("code-review"),
  findings: Schema.Array(CodeReviewFileFindingSchema),
});

export type CodeReviewFile = Schema.Schema.Type<typeof CodeReviewFileSchema>;

export const decodeCodeReviewFile = Schema.decodeUnknownResult(CodeReviewFileSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

/**
 * The answer the review session gives: `$schema` first, then the findings.
 * Every key is required; any other key, an `id` on a finding included, is
 * refused, at any level.
 */
export const CodeReviewAnswerSchema = Schema.Struct({
  $schema: answerSchemaUrlField("code-review-answer"),
  findings: Schema.Array(CodeReviewFindingSchema),
});

export type CodeReviewAnswer = Schema.Schema.Type<typeof CodeReviewAnswerSchema>;

export const decodeCodeReviewAnswer = Schema.decodeUnknownResult(CodeReviewAnswerSchema, {
  errors: "all",
  onExcessProperty: "error",
  reportInput: true,
});

export const encodeCodeReviewFile = Schema.encodeSync(CodeReviewFileSchema);

/**
 * Reads the session's parsed answer, a `code-review-answer`: one that
 * does not meet it is a Left with the refusal text (every root-level issue,
 * `$schema` first, joined by `; `; else the first violation); otherwise the
 * findings, without `$schema`. Reading the final text as JSON is the caller's.
 */
export function readCodeReviewAnswer(parsed: unknown): Result.Result<CodeReview, string> {
  const decoded = decodeCodeReviewAnswer(parsed);
  if (Result.isFailure(decoded))
    return Result.fail(formatAnswerViolations(parsed, decoded.failure));
  return Result.succeed({ findings: decoded.success.findings });
}

/** The text of `code-review.json`: `$schema` first, then the findings with their ids, indented by 2. */
export function codeReviewFileText(review: PersistedCodeReview): string {
  const file = encodeCodeReviewFile({
    $schema: schemaUrl("code-review", CURRENT_STAMPS["code-review"]),
    findings: review.findings,
  });
  return JSON.stringify(file, null, 2);
}
