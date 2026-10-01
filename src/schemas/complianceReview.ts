import { Schema, type Types } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

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

const complianceReviewFields = {
  verdict: VerdictSchema,
  summary: Schema.String,
  perPhase: Schema.Array(PhaseVerdictSchema),
  attentionPoints: Schema.Array(Schema.String),
  pointers: Schema.Array(Schema.String),
};

/** The verdict the review agent writes in `.phax-context`: `version: 1`, then the review. */
export const ComplianceReviewSchema = Schema.Struct({
  version: Schema.Literal(1),
  ...complianceReviewFields,
});
export type ComplianceReviewVerdict = Schema.Schema.Type<typeof ComplianceReviewSchema>;

// The verdict the review agent writes: decoded with this contract, never through the bridge.
export const decodeComplianceReview = Schema.decodeUnknownEither(ComplianceReviewSchema, {
  onExcessProperty: "error",
});

/** A compliance review in memory: never a `version`, never a `$schema`. */
export type ComplianceReview = Types.Simplify<Schema.Struct.Type<typeof complianceReviewFields>>;

/**
 * `compliance-review.json` as phax persists it: `$schema` first, then the
 * review. Unknown keys are rejected.
 */
export const ComplianceReviewFileSchema = Schema.Struct({
  $schema: schemaUrlField("compliance-review"),
  ...complianceReviewFields,
});

export type ComplianceReviewFile = Schema.Schema.Type<typeof ComplianceReviewFileSchema>;

export const decodeComplianceReviewFile = Schema.decodeUnknownEither(ComplianceReviewFileSchema, {
  onExcessProperty: "error",
});
export const encodeComplianceReviewFile = Schema.encodeSync(ComplianceReviewFileSchema);
