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
  currentPhaseIndex: Schema.optionalWith(Schema.Number, { exact: true }),
  gateProfileId: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  stoppedReason: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  lastError: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  planRepoRelPath: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  allowSkillEdits: Schema.optionalWith(Schema.Boolean, { exact: true }),
});

export type RunStatusPreSchema = Schema.Schema.Type<typeof RunStatusPreSchemaSchema>;

export const decodeRunStatusPreSchema = Schema.decodeUnknownEither(RunStatusPreSchemaSchema);
