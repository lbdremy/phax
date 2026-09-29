// Frozen: a run's compliance-review.json as phax wrote it with `version: 1`
// (copied from src/schemas/complianceReview.ts at 233f1f18).
// Pinned by hash in packages/schemas/history.lock.json — never edit.
// Self-contained: imports only effect, so later changes to phax's
// src/schemas cannot reach it.
import { Schema } from "effect";

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

export const ComplianceReviewV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  verdict: VerdictSchema,
  summary: Schema.String,
  perPhase: Schema.Array(PhaseVerdictSchema),
  attentionPoints: Schema.Array(Schema.String),
  pointers: Schema.Array(Schema.String),
});

export type ComplianceReviewV1 = Schema.Schema.Type<typeof ComplianceReviewV1Schema>;

export const decodeComplianceReviewV1 = Schema.decodeUnknownEither(ComplianceReviewV1Schema, {
  onExcessProperty: "error",
});
