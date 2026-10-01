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

/** The plan approvals ledger in memory: never a `version`, never a `$schema`. */
export type PlanApprovals = Types.Simplify<Schema.Struct.Type<typeof planApprovalsFields>>;

/**
 * `docs/plans/approvals.json` as phax persists it: `$schema` first, then the
 * records. Unknown keys are rejected.
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
