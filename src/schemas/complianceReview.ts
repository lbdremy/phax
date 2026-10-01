import { Schema } from "effect";

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
  phaseId: Schema.NonEmptyString,
  verdict: VerdictSchema,
  findings: Schema.Array(FindingSchema),
});
export type PhaseVerdict = Schema.Schema.Type<typeof PhaseVerdictSchema>;

export const ComplianceReviewSchema = Schema.Struct({
  version: Schema.Literal(1),
  verdict: VerdictSchema,
  summary: Schema.String,
  perPhase: Schema.Array(PhaseVerdictSchema),
  attentionPoints: Schema.Array(Schema.String),
  pointers: Schema.Array(Schema.String),
});
export type ComplianceReview = Schema.Schema.Type<typeof ComplianceReviewSchema>;

// The verdict the review agent writes: decoded with this contract, never through the bridge.
export const decodeComplianceReview = Schema.decodeUnknownEither(ComplianceReviewSchema, {
  onExcessProperty: "error",
});

/**
 * `compliance-review.json` as phax persists it: the agent contract until the
 * review file gains `$schema`.
 * @alias
 */
export const ComplianceReviewFileSchema = ComplianceReviewSchema;

export const decodeComplianceReviewFile = Schema.decodeUnknownEither(ComplianceReviewFileSchema, {
  onExcessProperty: "error",
});
