// The `code-review` document: `<run folder>/code-review.json`, the findings of
// the headless code review of spec headless-code-review. The session answers
// this very shape, `{ $schema, findings }`, as its final message (a strict
// answer since 0.32.0: the `$schema` const and `strictString`'s pattern), and
// phax persists the findings as they came. Born with `$schema`. The closed
// severity, lens and escape ids are the ones the bundled `phax-review` skill
// lists; a test keeps the two equal.
import { Either, Schema } from "effect";
import { answerSchemaUrlField } from "./answerStamp.js";
import { formatAnswerViolations } from "./formatError.js";
import { CURRENT_STAMPS } from "./release.js";
import { schemaUrl } from "./schemaUrl.js";
import { NonEmptyString } from "./strictString.js";

// A value outside a closed set names itself and the set: `"security" is not a
// lens (expected one of surface, acceptance, …)`.
// The literal union reports its first member otherwise, hence the override.
const notOneOf =
  (noun: string, ids: readonly string[]) => (issue: { readonly actual: unknown }) => ({
    message: `${JSON.stringify(issue.actual)} is not ${noun} (expected one of ${ids.join(", ")})`,
    override: true,
  });

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

export const CodeReviewSeveritySchema = Schema.Literal(...SEVERITY_IDS).annotations({
  message: notOneOf("a severity", SEVERITY_IDS),
});

export const CodeReviewLensSchema = Schema.Literal(...LENS_IDS).annotations({
  message: notOneOf("a lens", LENS_IDS),
});

export const CodeReviewEscapeSchema = Schema.Literal(...ESCAPE_IDS).annotations({
  message: notOneOf("an escape", ESCAPE_IDS),
});

export type CodeReviewSeverity = Schema.Schema.Type<typeof CodeReviewSeveritySchema>;
export type CodeReviewLens = Schema.Schema.Type<typeof CodeReviewLensSchema>;
export type CodeReviewEscape = Schema.Schema.Type<typeof CodeReviewEscapeSchema>;

export const CODE_REVIEW_SEVERITIES = CodeReviewSeveritySchema.literals;
export const CODE_REVIEW_LENSES = CodeReviewLensSchema.literals;
export const CODE_REVIEW_ESCAPES = CodeReviewEscapeSchema.literals;

export const CODE_REVIEW_JSON_FILENAME = "code-review.json";

const CodeReviewFindingSchema = Schema.Struct({
  severity: CodeReviewSeveritySchema,
  file: NonEmptyString.annotations({
    description: "The path the finding is about, as the reviewer gave it.",
  }),
  line: Schema.Int.pipe(
    Schema.positive(),
    Schema.annotations({
      description: "The 1-based line the finding is about.",
      message: (issue) => ({
        message: `must be a positive integer, actual ${JSON.stringify(issue.actual)}`,
        override: true,
      }),
    }),
  ),
  message: NonEmptyString,
  lens: CodeReviewLensSchema,
  escape: CodeReviewEscapeSchema,
  criterion: Schema.NullOr(NonEmptyString).annotations({
    description: "The acceptance criterion id the finding is about, or null.",
  }),
  suggestion: NonEmptyString,
});

export type CodeReviewFinding = Schema.Schema.Type<typeof CodeReviewFindingSchema>;

/** A code review in memory: never a `$schema`. */
export interface CodeReview {
  readonly findings: readonly CodeReviewFinding[];
}

/**
 * A `code-review` document, which is also the answer the review session gives:
 * `$schema` first, then the findings. Every key is required; any other key is
 * refused, at any level.
 */
export const CodeReviewFileSchema = Schema.Struct({
  $schema: answerSchemaUrlField("code-review"),
  findings: Schema.Array(CodeReviewFindingSchema),
});

export type CodeReviewFile = Schema.Schema.Type<typeof CodeReviewFileSchema>;

export const decodeCodeReviewFile = Schema.decodeUnknownEither(CodeReviewFileSchema, {
  onExcessProperty: "error",
});

const decodeCodeReviewAnswerAll = Schema.decodeUnknownEither(CodeReviewFileSchema, {
  errors: "all",
  onExcessProperty: "error",
});

export const encodeCodeReviewFile = Schema.encodeSync(CodeReviewFileSchema);

/**
 * Reads the session's parsed answer, which is the file's own shape: one that
 * does not meet it is a Left with the refusal text (every root-level issue,
 * `$schema` first, joined by `; `; else the first violation); otherwise the
 * findings, without `$schema`. Reading the final text as JSON is the caller's.
 */
export function readCodeReviewAnswer(parsed: unknown): Either.Either<CodeReview, string> {
  const decoded = decodeCodeReviewAnswerAll(parsed);
  if (Either.isLeft(decoded)) return Either.left(formatAnswerViolations(decoded.left));
  return Either.right({ findings: decoded.right.findings });
}

/** The text of `code-review.json`: `$schema` first, then the findings, indented by 2. */
export function codeReviewFileText(review: CodeReview): string {
  const file = encodeCodeReviewFile({
    $schema: schemaUrl("code-review", CURRENT_STAMPS["code-review"]),
    findings: review.findings,
  });
  return JSON.stringify(file, null, 2);
}
