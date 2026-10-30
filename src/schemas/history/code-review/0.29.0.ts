// The frozen 0.29.0 shape of `code-review`: the `code-review.json` phax wrote
// from 0.29.0 through 0.31.x, `$schema` first, then the findings. Born with
// `$schema`; every key is required and any other key is refused, at any level.
// Never edit this module: packages/schemas/history.lock.json pins its bytes. In
// phax, only src/schemas/persisted.ts and the tests may import it; the schemas
// package lists it as the format's 0.29.0 release. It carries its own closed
// ids and Effect NonEmptyString, so a later change to src/schemas/codeReview.ts
// cannot move it.
import { Schema } from "effect";

const CodeReviewSchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/code-review\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The code-review format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/code-review/<X.Y.Z>.json",
  }),
);

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

const SeveritySchema = Schema.Literal(...SEVERITY_IDS).annotations({
  message: notOneOf("a severity", SEVERITY_IDS),
});

const LensSchema = Schema.Literal(...LENS_IDS).annotations({
  message: notOneOf("a lens", LENS_IDS),
});

const EscapeSchema = Schema.Literal(...ESCAPE_IDS).annotations({
  message: notOneOf("an escape", ESCAPE_IDS),
});

const FindingSchema = Schema.Struct({
  severity: SeveritySchema,
  file: Schema.NonEmptyString.annotations({
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
  message: Schema.NonEmptyString,
  lens: LensSchema,
  escape: EscapeSchema,
  criterion: Schema.NullOr(Schema.NonEmptyString).annotations({
    description: "The acceptance criterion id the finding is about, or null.",
  }),
  suggestion: Schema.NonEmptyString,
});

/** A 0.29.0 `code-review` document. Exactly these keys; any other is refused. */
export const CodeReviewV0_29_0Schema = Schema.Struct({
  $schema: CodeReviewSchemaUrlSchema,
  findings: Schema.Array(FindingSchema),
});

export type CodeReviewV0_29_0 = Schema.Schema.Type<typeof CodeReviewV0_29_0Schema>;

export const decodeCodeReviewV0_29_0 = Schema.decodeUnknownEither(CodeReviewV0_29_0Schema, {
  onExcessProperty: "error",
});
