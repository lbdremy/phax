// The frozen 0.19.0 shape of `plan-approval-record`: the
// docs/plans/approvals/<plan>.json phax 0.19.0 through 0.24.x wrote, `$schema`
// first and no `approvedBy`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package lists it as the
// format's 0.19.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/plan-approval-record\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The plan-approval-record format and the phax release that wrote this file: https://docs.phax.run/schemas/plan-approval-record/<X.Y.Z>.json",
  }),
);

const SourceSpecBindingSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  fingerprint: Schema.NonEmptyString,
});

export const PlanApprovalRecordV0_19_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  artifact: Schema.NonEmptyString,
  planFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.pipe(Schema.pattern(/^[0-9a-f]{40}$/)),
  sourceSpec: Schema.NullOr(SourceSpecBindingSchema),
});

export type PlanApprovalRecordV0_19_0 = Schema.Schema.Type<typeof PlanApprovalRecordV0_19_0Schema>;

export const decodePlanApprovalRecordV0_19_0 = Schema.decodeUnknownEither(
  PlanApprovalRecordV0_19_0Schema,
  { onExcessProperty: "error" },
);
