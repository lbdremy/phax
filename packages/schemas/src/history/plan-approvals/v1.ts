// Frozen: docs/plans/approvals.json as phax wrote it with `version: 1`
// (copied from src/schemas/approvalRecord.ts at 2fa9c90a).
// Pinned by hash in packages/schemas/history.lock.json — never edit.
// Self-contained: imports only effect, so later changes to phax's
// src/schemas cannot reach it.
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

export const PlanApprovalsV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  records: Schema.Record({ key: Schema.String, value: ApprovalRecordSchema }),
});

export type PlanApprovalsV1 = Schema.Schema.Type<typeof PlanApprovalsV1Schema>;

export const decodePlanApprovalsV1 = Schema.decodeUnknownEither(PlanApprovalsV1Schema, {
  onExcessProperty: "error",
});
