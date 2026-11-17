// The frozen 0.32.0 shape of `compliance-review`: the `compliance-review.json`
// phax wrote from 0.32.0 through 0.39.x, `$schema` first, then the review with
// its two ledgers. Every key is required and any other key is refused, at any
// level. A finding carries no `id`: phax lifts one by position when it reads
// the run's reviews.
// Never edit this module: packages/schemas/history.lock.json pins its bytes. In
// phax, only src/schemas/persisted.ts and the tests may import it; the schemas
// package lists it as the format's 0.32.0 release. It carries its own closed
// ids and strict non-empty string, so a later change to
// src/schemas/complianceReview.ts cannot move it.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

// The strict non-empty string: it refuses "" alone, and renders as a `pattern`.
const NonEmptyString = Schema.String.check(
  isExportedPattern(/^[\s\S]+$/, {
    identifier: "NonEmptyString",
    message: 'Expected a non empty string, actual ""',
  }),
);

const SCHEMA_URL = "https://docs.phax.run/schemas/compliance-review/0.32.0.json";

const ComplianceReviewSchemaUrlSchema = Schema.Literal(SCHEMA_URL).annotate({
  description: `The compliance-review format's shape, exactly: ${SCHEMA_URL}`,
  const: SCHEMA_URL,
});

const VerdictSchema = Schema.Literals(["conformant", "conformant-with-deviations", "divergent"]);

const SeveritySchema = Schema.Literals(["info", "deviation", "concern"]);

const DimensionSchema = Schema.Literals([
  "objective",
  "excluded-scope",
  "files",
  "tests",
  "boundaries",
  "commit",
  "handoff",
]);

const FindingSchema = Schema.Struct({
  dimension: DimensionSchema,
  severity: SeveritySchema,
  message: Schema.String,
});

const PhaseVerdictSchema = Schema.Struct({
  phaseId: NonEmptyString,
  verdict: VerdictSchema,
  findings: Schema.Array(FindingSchema),
});

const UnplannedChangeSchema = Schema.Struct({
  phaseId: NonEmptyString,
  path: NonEmptyString,
  note: NonEmptyString,
});

const UnmetPromiseSchema = Schema.Struct({
  phaseId: NonEmptyString,
  promise: NonEmptyString,
  note: NonEmptyString,
});

/** A 0.32.0 `compliance-review` document. Exactly these keys; any other is refused. */
export const ComplianceReviewV0_32_0Schema = Schema.Struct({
  $schema: ComplianceReviewSchemaUrlSchema,
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
});

export type ComplianceReviewV0_32_0 = Schema.Schema.Type<typeof ComplianceReviewV0_32_0Schema>;

export const decodeComplianceReviewV0_32_0 = Schema.decodeUnknownResult(
  ComplianceReviewV0_32_0Schema,
  { onExcessProperty: "error", reportInput: true },
);
