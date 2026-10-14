// The frozen 0.19.0 shape of `spec-approval-record`: the
// docs/specs/approvals/<spec>.json phax 0.19.0 through 0.24.x wrote, `$schema`
// first and no `approvedBy`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package lists it as the
// format's 0.19.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/spec-approval-record\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The spec-approval-record format and the phax release that wrote this file: https://docs.phax.run/schemas/spec-approval-record/<X.Y.Z>.json",
  }),
);

export const SpecApprovalRecordV0_19_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  artifact: Schema.NonEmptyString,
  specFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.pipe(Schema.pattern(/^[0-9a-f]{40}$/)),
});

export type SpecApprovalRecordV0_19_0 = Schema.Schema.Type<typeof SpecApprovalRecordV0_19_0Schema>;

export const decodeSpecApprovalRecordV0_19_0 = Schema.decodeUnknownEither(
  SpecApprovalRecordV0_19_0Schema,
  { onExcessProperty: "error" },
);
