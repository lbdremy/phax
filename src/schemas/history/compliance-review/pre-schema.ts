// The frozen pre-schema shape of `compliance-review`: exactly what phax wrote
// before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
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

export const ComplianceReviewPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(1),
  verdict: VerdictSchema,
  summary: Schema.String,
  perPhase: Schema.Array(PhaseVerdictSchema),
  attentionPoints: Schema.Array(Schema.String),
  pointers: Schema.Array(Schema.String),
});

export type ComplianceReviewPreSchema = Schema.Schema.Type<typeof ComplianceReviewPreSchemaSchema>;

export const decodeComplianceReviewPreSchema = Schema.decodeUnknownEither(
  ComplianceReviewPreSchemaSchema,
  { onExcessProperty: "error" },
);
