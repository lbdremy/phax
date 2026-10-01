// The frozen pre-schema shape of `spec-approvals`: exactly what phax wrote
// before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
import { Schema } from "effect";

const SpecApprovalRecordSchema = Schema.Struct({
  specFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.pipe(Schema.pattern(/^[0-9a-f]{40}$/)),
});

export const SpecApprovalsPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(1),
  records: Schema.Record({ key: Schema.String, value: SpecApprovalRecordSchema }),
});

export type SpecApprovalsPreSchema = Schema.Schema.Type<typeof SpecApprovalsPreSchemaSchema>;

export const decodeSpecApprovalsPreSchema = Schema.decodeUnknownEither(
  SpecApprovalsPreSchemaSchema,
  { onExcessProperty: "error" },
);
