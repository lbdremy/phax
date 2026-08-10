import { Schema } from "effect";

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

export const ApprovalRecordFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  records: Schema.Record({ key: Schema.String, value: ApprovalRecordSchema }),
});

export type ApprovalRecordFile = Schema.Schema.Type<typeof ApprovalRecordFileSchema>;

export const decodeApprovalRecordFile = Schema.decodeUnknownEither(ApprovalRecordFileSchema, {
  onExcessProperty: "error",
});

export const encodeApprovalRecordFile = Schema.encodeSync(ApprovalRecordFileSchema);
