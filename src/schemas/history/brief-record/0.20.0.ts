// The frozen 0.20.0 shape of `brief-record`: the brief-NN.json phax 0.20.x
// wrote, `$schema` first, the brief request as sent, and an answered outcome
// whose answer was a brief answer. Its keys are those of the current shape;
// only the answer's description differs.
// Never edit this module: packages/schemas/history.lock.json pins its bytes.
// phax itself never imports it; the schemas package lists it as the format's
// 0.20.0 release.
import { Schema } from "effect";

function schemaUrlSchema(formatId: "brief-request" | "brief-record", pattern: RegExp) {
  return Schema.String.check(Schema.isPattern(pattern)).pipe(
    Schema.annotate({
      description: `The ${formatId} format and the phax release that wrote this file: https://docs.phax.run/schemas/${formatId}/<X.Y.Z>.json`,
    }),
  );
}

const PhaseIdSchema = Schema.String.check(Schema.isPattern(/^phase-\d{2}$/));

const FullCommitShaSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
).pipe(
  Schema.annotate({
    description: "A commit's full object name: 40 lowercase hex digits (SHA-1) or 64 (SHA-256).",
  }),
);

const RequestPhaseSchema = Schema.Struct({
  id: PhaseIdSchema.annotate({ description: "The phase's id." }),
  files: Schema.Array(Schema.String).annotate({
    description:
      "The phase's planned files to create and to edit, deduplicated in plan order; optional files are excluded.",
  }),
});

const BriefPathsSchema = Schema.NonEmptyArray(Schema.NonEmptyString);

const PhaseBriefRequestSchema = Schema.Struct({
  $schema: schemaUrlSchema(
    "brief-request",
    /^https:\/\/docs\.phax\.run\/schemas\/brief-request\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  phase: PhaseIdSchema.annotate({ description: "The gated phase." }),
  base: FullCommitShaSchema.annotate({
    description: "The full object name of the commit the gated phase's branch was created from.",
  }),
  terminal: Schema.Boolean.annotate({
    description: "True exactly when the gated phase is the run's terminal phase.",
  }),
  phases: Schema.Array(RequestPhaseSchema).annotate({
    description: "Every phase of the run, in execution order, with its planned files.",
  }),
  files: Schema.NullOr(BriefPathsSchema).annotate({
    description:
      "Null for the phase's brief: the phase's planned files. Otherwise working-tree-root-relative paths, deduplicated, in the order given, never checked for existence.",
  }),
});

const OutsideBriefRequestSchema = Schema.Struct({
  $schema: schemaUrlSchema(
    "brief-request",
    /^https:\/\/docs\.phax\.run\/schemas\/brief-request\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  files: BriefPathsSchema.annotate({
    description:
      "Working-tree-root-relative paths, deduplicated, in the order given, never checked for existence.",
  }),
});

const AnsweredOutcomeSchema = Schema.Struct({
  kind: Schema.Literal("answered"),
  answer: Schema.Record(Schema.String, Schema.Unknown).annotate({
    description:
      "The brief answer as the provider printed it, its own $schema and any extra key included, never re-stamped or re-shaped. It decodes by its own $schema, with parseBriefAnswer.",
  }),
});

const FailedOutcomeSchema = Schema.Struct({
  kind: Schema.Literal("failed"),
  reason: Schema.NonEmptyString.annotate({
    description: "Why the brief call gave no answer, in one line.",
  }),
});

export const BriefRecordV0_20_0Schema = Schema.Struct({
  $schema: schemaUrlSchema(
    "brief-record",
    /^https:\/\/docs\.phax\.run\/schemas\/brief-record\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  moment: Schema.Literals(["pushed", "pulled"]).annotate({
    description: "pushed for the phase's brief at phase start (brief-00 only), pulled otherwise.",
  }),
  request: Schema.Union([PhaseBriefRequestSchema, OutsideBriefRequestSchema]).annotate({
    description: "The brief request as phax sent it on the provider's stdin.",
  }),
  outcome: Schema.Union([AnsweredOutcomeSchema, FailedOutcomeSchema]),
});

export type BriefRecordV0_20_0 = Schema.Schema.Type<typeof BriefRecordV0_20_0Schema>;

export const decodeBriefRecordV0_20_0 = Schema.decodeUnknownResult(BriefRecordV0_20_0Schema, {
  onExcessProperty: "error",
  reportInput: true,
});
