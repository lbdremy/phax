// The frozen pre-schema shape of `spec-approvals`: exactly what phax wrote
// before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

const SpecApprovalRecordSchema = Schema.Struct({
  specFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.check(isExportedPattern(/^[0-9a-f]{40}$/)),
});

export const SpecApprovalsPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(1),
  records: Schema.Record(Schema.String, SpecApprovalRecordSchema),
});

export type SpecApprovalsPreSchema = Schema.Schema.Type<typeof SpecApprovalsPreSchemaSchema>;

export const decodeSpecApprovalsPreSchema = Schema.decodeUnknownResult(
  SpecApprovalsPreSchemaSchema,
  { onExcessProperty: "error", reportInput: true },
);
