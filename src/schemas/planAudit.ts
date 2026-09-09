import { Schema } from "effect";

export const PlanAuditFindingSchema = Schema.Struct({
  message: Schema.NonEmptyString,
  phases: Schema.Array(Schema.NonEmptyString),
});

export type PlanAuditFinding = Schema.Schema.Type<typeof PlanAuditFindingSchema>;

export const PlanAuditResponseSchema = Schema.Struct({
  findings: Schema.Array(PlanAuditFindingSchema),
});

export type PlanAuditResponse = Schema.Schema.Type<typeof PlanAuditResponseSchema>;

export const decodePlanAuditResponse = Schema.decodeUnknownEither(PlanAuditResponseSchema);
