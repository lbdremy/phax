// The frozen 0.25.0 shape of `plan-approval-record`: the
// docs/plans/approvals/<plan>.json phax 0.25.0 through 0.39.x wrote, `$schema`
// first, then the record, then `approvedBy`, and no `code`. Never edit this
// module: packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts and the tests may import it. The schemas package
// lists it as the format's 0.25.0 release. It carries its own pattern helper,
// stamp, source-spec binding and approver, so a later change to
// src/schemas/approvalRecord.ts cannot move it.
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
    /^https:\/\/docs\.phax\.run\/schemas\/plan-approval-record\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The plan-approval-record format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/plan-approval-record/<X.Y.Z>.json",
  }),
);

const SourceSpecBindingSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  fingerprint: Schema.NonEmptyString,
});

const ApprovedBySchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("machine"),
    grant: Schema.String.check(isExportedPattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)).pipe(
      Schema.annotate({
        description: "The grant the machine declared with `--by machine:<grant>`.",
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("operator"),
    name: Schema.NonEmptyString.annotate({
      description: "The operator's git user.name when they approved.",
    }),
  }),
  Schema.Struct({ kind: Schema.Literal("unattributed") }),
]);

export const PlanApprovalRecordV0_25_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  artifact: Schema.NonEmptyString,
  planFingerprint: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  baseline: Schema.NonEmptyString.check(isExportedPattern(/^[0-9a-f]{40}$/)),
  sourceSpec: Schema.NullOr(SourceSpecBindingSchema),
  approvedBy: ApprovedBySchema,
});

export type PlanApprovalRecordV0_25_0 = Schema.Schema.Type<typeof PlanApprovalRecordV0_25_0Schema>;

export const decodePlanApprovalRecordV0_25_0 = Schema.decodeUnknownResult(
  PlanApprovalRecordV0_25_0Schema,
  { onExcessProperty: "error", reportInput: true },
);
