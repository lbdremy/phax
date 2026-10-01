// The frozen pre-schema shape of `plan-approvals`: exactly what phax wrote
// before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
import { Schema } from "effect";

const SourceSpecBindingSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  fingerprint: Schema.NonEmptyString,
});

const ApprovalRecordSchema = Schema.Struct({
  planFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.pipe(Schema.pattern(/^[0-9a-f]{40}$/)),
  sourceSpec: Schema.NullOr(SourceSpecBindingSchema),
});

export const PlanApprovalsPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(1),
  records: Schema.Record({ key: Schema.String, value: ApprovalRecordSchema }),
});

export type PlanApprovalsPreSchema = Schema.Schema.Type<typeof PlanApprovalsPreSchemaSchema>;

export const decodePlanApprovalsPreSchema = Schema.decodeUnknownEither(
  PlanApprovalsPreSchemaSchema,
  { onExcessProperty: "error" },
);
