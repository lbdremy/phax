// The frozen 0.19.0 shape of `spec-approval-record`: the
// docs/specs/approvals/<spec>.json phax 0.19.0 through 0.24.x wrote, `$schema`
// first and no `approvedBy`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package lists it as the
// format's 0.19.0 release.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

const SchemaUrlSchema = Schema.String.check(
  isExportedPattern(
    /^https:\/\/docs\.phax\.run\/schemas\/spec-approval-record\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The spec-approval-record format and the phax release that wrote this file: https://docs.phax.run/schemas/spec-approval-record/<X.Y.Z>.json",
  }),
);

export const SpecApprovalRecordV0_19_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  artifact: Schema.NonEmptyString,
  specFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.check(isExportedPattern(/^[0-9a-f]{40}$/)),
});

export type SpecApprovalRecordV0_19_0 = Schema.Schema.Type<typeof SpecApprovalRecordV0_19_0Schema>;

export const decodeSpecApprovalRecordV0_19_0 = Schema.decodeUnknownResult(
  SpecApprovalRecordV0_19_0Schema,
  { onExcessProperty: "error", reportInput: true },
);
