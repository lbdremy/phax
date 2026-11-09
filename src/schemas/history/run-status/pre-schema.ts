// The frozen pre-schema shape of `run-status`: exactly what phax wrote before
// it wrote `$schema`. Never edit this module: packages/schemas/history.lock.json
// pins its bytes. In phax, only src/schemas/persisted.ts may import it. The
// schemas package re-exports its schema and type.
import { Schema } from "effect";

const RunStateSchema = Schema.Union(
  Schema.Literal("created"),
  Schema.Literal("running"),
  Schema.Literal("failed"),
  Schema.Literal("review_open"),
  Schema.Literal("completed"),
  Schema.Literal("stopped"),
  Schema.Literal("archived"),
  Schema.Literal("interrupted"),
  Schema.Literal("rate_limited"),
);

export const RunStatusPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(1),
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

export type RunStatusPreSchema = Schema.Schema.Type<typeof RunStatusPreSchemaSchema>;

export const decodeRunStatusPreSchema = Schema.decodeUnknownResult(RunStatusPreSchemaSchema);
