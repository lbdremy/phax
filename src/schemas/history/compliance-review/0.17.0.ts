// The frozen 0.17.0 shape of `compliance-review`: the `compliance-review.json`
// phax wrote from 0.17.0 through 0.31.x, `$schema` first, then the review.
// Every key is required and any other key is refused, at any level. It has
// neither ledger (`unplannedChanges`, `unmetPromises`).
// Never edit this module: packages/schemas/history.lock.json pins its bytes. In
// phax, only src/schemas/persisted.ts and the tests may import it; the schemas
// package lists it as the format's 0.17.0 release. It carries its own closed
// ids and Effect NonEmptyString, so a later change to src/schemas/complianceReview.ts
// cannot move it.
import { Schema } from "effect";

const ComplianceReviewSchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/compliance-review\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The compliance-review format and the phax release that wrote this file: https://docs.phax.run/schemas/compliance-review/<X.Y.Z>.json",
  }),
);

const VerdictSchema = Schema.Literal("conformant", "conformant-with-deviations", "divergent");

const SeveritySchema = Schema.Literal("info", "deviation", "concern");

const DimensionSchema = Schema.Literal(
  "objective",
  "excluded-scope",
  "files",
  "tests",
  "boundaries",
  "commit",
  "handoff",
);

const FindingSchema = Schema.Struct({
  dimension: DimensionSchema,
  severity: SeveritySchema,
  message: Schema.String,
});

const PhaseVerdictSchema = Schema.Struct({
  phaseId: Schema.NonEmptyString,
  verdict: VerdictSchema,
  findings: Schema.Array(FindingSchema),
});

/** A 0.17.0 `compliance-review` document. Exactly these keys; any other is refused. */
export const ComplianceReviewV0_17_0Schema = Schema.Struct({
  $schema: ComplianceReviewSchemaUrlSchema,
  verdict: VerdictSchema,
  summary: Schema.String,
  perPhase: Schema.Array(PhaseVerdictSchema),
  attentionPoints: Schema.Array(Schema.String),
  pointers: Schema.Array(Schema.String),
});

export type ComplianceReviewV0_17_0 = Schema.Schema.Type<typeof ComplianceReviewV0_17_0Schema>;

export const decodeComplianceReviewV0_17_0 = Schema.decodeUnknownEither(
  ComplianceReviewV0_17_0Schema,
  { onExcessProperty: "error" },
);
