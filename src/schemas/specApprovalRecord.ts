import { Schema } from "effect";

export const SpecApprovalRecordSchema = Schema.Struct({
  specFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.pipe(Schema.pattern(/^[0-9a-f]{40}$/)),
});

export type SpecApprovalRecord = Schema.Schema.Type<typeof SpecApprovalRecordSchema>;

export const SpecApprovalRecordFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  records: Schema.Record({ key: Schema.String, value: SpecApprovalRecordSchema }),
});

export type SpecApprovalRecordFile = Schema.Schema.Type<typeof SpecApprovalRecordFileSchema>;

export const decodeSpecApprovalRecordFile = Schema.decodeUnknownEither(
  SpecApprovalRecordFileSchema,
  { onExcessProperty: "error" },
);

export const encodeSpecApprovalRecordFile = Schema.encodeSync(SpecApprovalRecordFileSchema);
