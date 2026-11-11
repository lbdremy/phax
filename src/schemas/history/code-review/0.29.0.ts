// The frozen 0.29.0 shape of `code-review`: the `code-review.json` phax wrote
// from 0.29.0 through 0.31.x, `$schema` first, then the findings. Born with
// `$schema`; every key is required and any other key is refused, at any level.
// Never edit this module: packages/schemas/history.lock.json pins its bytes. In
// phax, only src/schemas/persisted.ts and the tests may import it; the schemas
// package lists it as the format's 0.29.0 release. It carries its own closed
// ids and Effect NonEmptyString, so a later change to src/schemas/codeReview.ts
// cannot move it.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

const CodeReviewSchemaUrlSchema = Schema.String.check(
  isExportedPattern(
    /^https:\/\/docs\.phax\.run\/schemas\/code-review\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The code-review format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/code-review/<X.Y.Z>.json",
  }),
);

// phax's own refusal text for a refused value, computed from it. The annotation key is the
// one src/schemas/refusal/adapter.ts reads, written out here because a frozen module imports
// only effect.
const refusalOverride = (message: (actual: unknown) => string) => ({
  phaxRefusalOverride: message,
});

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

const SeveritySchema = Schema.Literals(SEVERITY_IDS).annotate(notOneOf("a severity", SEVERITY_IDS));

const LensSchema = Schema.Literals(LENS_IDS).annotate(notOneOf("a lens", LENS_IDS));

const EscapeSchema = Schema.Literals(ESCAPE_IDS).annotate(notOneOf("an escape", ESCAPE_IDS));

const FindingSchema = Schema.Struct({
  severity: SeveritySchema,
  file: Schema.NonEmptyString.annotate({
    description: "The path the finding is about, as the reviewer gave it.",
  }),
  line: Schema.Int.check(Schema.isGreaterThan(0)).pipe(
    Schema.annotate({
      description: "The 1-based line the finding is about.",
      ...refusalOverride(
        (actual) => `must be a positive integer, actual ${JSON.stringify(actual)}`,
      ),
    }),
  ),
  message: Schema.NonEmptyString,
  lens: LensSchema,
  escape: EscapeSchema,
  criterion: Schema.NullOr(Schema.NonEmptyString).annotate({
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

export const decodeCodeReviewV0_29_0 = Schema.decodeUnknownResult(CodeReviewV0_29_0Schema, {
  onExcessProperty: "error",
  reportInput: true,
});
