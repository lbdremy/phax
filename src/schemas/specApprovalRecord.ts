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

/**
 * The spec approvals ledger in memory: never a `version`, never a `$schema`.
 * The old shared ledger, read only to migrate it to record files.
 */
export type SpecApprovals = Types.Simplify<Schema.Struct.Type<typeof specApprovalsFields>>;

/**
 * `docs/specs/approvals.json`, the old spec approvals ledger, as phax wrote
 * it: `$schema` first, then the records. Unknown keys are rejected. Read only
 * to migrate it to record files; phax never writes it again.
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

const specRecordFields = {
  artifact: Schema.NonEmptyString,
  ...SpecApprovalRecordSchema.fields,
};

/**
 * One spec's approval record in memory: the record file without `$schema`.
 * `artifact` is the spec path the record approves.
 */
export type SpecRecord = Types.Simplify<Schema.Struct.Type<typeof specRecordFields>>;

/**
 * `docs/specs/approvals/<spec>.json`, one spec's approval record file:
 * `$schema` first, then `artifact`, then the record. Born with `$schema`;
 * unknown keys are rejected.
 */
export const SpecRecordFileSchema = Schema.Struct({
  $schema: schemaUrlField("spec-approval-record"),
  ...specRecordFields,
});

export type SpecRecordFile = Schema.Schema.Type<typeof SpecRecordFileSchema>;

export const decodeSpecRecordFile = Schema.decodeUnknownEither(SpecRecordFileSchema, {
  onExcessProperty: "error",
});

export const encodeSpecRecordFile = Schema.encodeSync(SpecRecordFileSchema);
