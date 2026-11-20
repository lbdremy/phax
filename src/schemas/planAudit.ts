import { Schema } from "effect";

const PlanAuditFindingSchema = Schema.Struct({
  message: Schema.NonEmptyString,
  phases: Schema.Array(Schema.NonEmptyString),
});

const PlanAuditResponseSchema = Schema.Struct({
  findings: Schema.Array(PlanAuditFindingSchema),
});

export type PlanAuditResponse = Schema.Schema.Type<typeof PlanAuditResponseSchema>;

export const decodePlanAuditResponse = Schema.decodeUnknownResult(PlanAuditResponseSchema, {
  reportInput: true,
});
