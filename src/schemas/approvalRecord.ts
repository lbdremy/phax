import { Schema, type Types } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

const SourceSpecBindingSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  fingerprint: Schema.NonEmptyString,
});

export const ApprovalRecordSchema = Schema.Struct({
  planFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.pipe(Schema.pattern(/^[0-9a-f]{40}$/)),
  sourceSpec: Schema.NullOr(SourceSpecBindingSchema),
});

export type ApprovalRecord = Schema.Schema.Type<typeof ApprovalRecordSchema>;

const planApprovalsFields = {
  records: Schema.Record({ key: Schema.String, value: ApprovalRecordSchema }),
};

/**
 * The plan approvals ledger in memory: never a `version`, never a `$schema`.
 * The old shared ledger, read only to migrate it to record files.
 */
export type PlanApprovals = Types.Simplify<Schema.Struct.Type<typeof planApprovalsFields>>;

/**
 * `docs/plans/approvals.json`, the old plan approvals ledger, as phax wrote
 * it: `$schema` first, then the records. Unknown keys are rejected. Read only
 * to migrate it to record files; phax never writes it again.
 */
export const ApprovalRecordFileSchema = Schema.Struct({
  $schema: schemaUrlField("plan-approvals"),
  ...planApprovalsFields,
});

export type ApprovalRecordFile = Schema.Schema.Type<typeof ApprovalRecordFileSchema>;

export const decodeApprovalRecordFile = Schema.decodeUnknownEither(ApprovalRecordFileSchema, {
  onExcessProperty: "error",
});

export const encodeApprovalRecordFile = Schema.encodeSync(ApprovalRecordFileSchema);

const planRecordFields = {
  artifact: Schema.NonEmptyString,
  ...ApprovalRecordSchema.fields,
};

/**
 * One plan's approval record in memory: the record file without `$schema`.
 * `artifact` is the plan path the record approves.
 */
export type PlanRecord = Types.Simplify<Schema.Struct.Type<typeof planRecordFields>>;

/**
 * `docs/plans/approvals/<plan>.json`, one plan's approval record file:
 * `$schema` first, then `artifact`, then the record. Born with `$schema`;
 * unknown keys are rejected.
 */
export const PlanRecordFileSchema = Schema.Struct({
  $schema: schemaUrlField("plan-approval-record"),
  ...planRecordFields,
});

export type PlanRecordFile = Schema.Schema.Type<typeof PlanRecordFileSchema>;

export const decodePlanRecordFile = Schema.decodeUnknownEither(PlanRecordFileSchema, {
  onExcessProperty: "error",
});

export const encodePlanRecordFile = Schema.encodeSync(PlanRecordFileSchema);
