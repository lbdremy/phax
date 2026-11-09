// The frozen 0.17.0 shape of `run-status`: the run-status.json phax 0.17.0
// through 0.26.x wrote, `$schema` first and no `awaiting_review` state. Never
// edit this module: packages/schemas/history.lock.json pins its bytes. In
// phax, only src/schemas/persisted.ts may import it; the schemas package lists
// it as the format's 0.17.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.check(
  Schema.isPattern(
    /^https:\/\/docs\.phax\.run\/schemas\/run-status\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The run-status format and the phax release that wrote this file: https://docs.phax.run/schemas/run-status/<X.Y.Z>.json",
  }),
);

const RunStateSchema = Schema.Union([
  Schema.Literal("created"),
  Schema.Literal("running"),
  Schema.Literal("failed"),
  Schema.Literal("review_open"),
  Schema.Literal("completed"),
  Schema.Literal("stopped"),
  Schema.Literal("archived"),
  Schema.Literal("interrupted"),
  Schema.Literal("rate_limited"),
]);

export const RunStatusV0_17_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  namespace: Schema.NonEmptyString,
  shortName: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  state: RunStateSchema,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  phasesCount: Schema.Number,
  currentPhaseIndex: Schema.optionalKey(Schema.Number),
  gateProfileId: Schema.optionalKey(Schema.NonEmptyString),
  stoppedReason: Schema.optionalKey(Schema.NonEmptyString),
  lastError: Schema.optionalKey(Schema.NonEmptyString),
  planRepoRelPath: Schema.optionalKey(Schema.NonEmptyString),
  allowSkillEdits: Schema.optionalKey(Schema.Boolean),
});

export type RunStatusV0_17_0 = Schema.Schema.Type<typeof RunStatusV0_17_0Schema>;

export const decodeRunStatusV0_17_0 = Schema.decodeUnknownResult(RunStatusV0_17_0Schema, {
  reportInput: true,
});
