// Frozen: docs/specs/approvals.json as phax wrote it with `version: 1`
// (copied from src/schemas/specApprovalRecord.ts at 2fa9c90a).
// Pinned by hash in packages/schemas/history.lock.json — never edit.
// Self-contained: imports only effect, so later changes to phax's
// src/schemas cannot reach it.
import { Schema } from "effect";

const SpecApprovalRecordSchema = Schema.Struct({
  specFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.pipe(Schema.pattern(/^[0-9a-f]{40}$/)),
});

export const SpecApprovalsV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  records: Schema.Record({ key: Schema.String, value: SpecApprovalRecordSchema }),
});

export type SpecApprovalsV1 = Schema.Schema.Type<typeof SpecApprovalsV1Schema>;

export const decodeSpecApprovalsV1 = Schema.decodeUnknownEither(SpecApprovalsV1Schema, {
  onExcessProperty: "error",
});
