import { Schema, type Types } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

export const SpecApprovalRecordSchema = Schema.Struct({
  specFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.pipe(Schema.pattern(/^[0-9a-f]{40}$/)),
});

export type SpecApprovalRecord = Schema.Schema.Type<typeof SpecApprovalRecordSchema>;

const specApprovalsFields = {
  records: Schema.Record({ key: Schema.String, value: SpecApprovalRecordSchema }),
};

/** The spec approvals ledger in memory: never a `version`, never a `$schema`. */
export type SpecApprovals = Types.Simplify<Schema.Struct.Type<typeof specApprovalsFields>>;

/**
 * `docs/specs/approvals.json` as phax persists it: `$schema` first, then the
 * records. Unknown keys are rejected.
 */
export const SpecApprovalRecordFileSchema = Schema.Struct({
  $schema: schemaUrlField("spec-approvals"),
  ...specApprovalsFields,
});

export type SpecApprovalRecordFile = Schema.Schema.Type<typeof SpecApprovalRecordFileSchema>;

export const decodeSpecApprovalRecordFile = Schema.decodeUnknownEither(
  SpecApprovalRecordFileSchema,
  { onExcessProperty: "error" },
);

export const encodeSpecApprovalRecordFile = Schema.encodeSync(SpecApprovalRecordFileSchema);
