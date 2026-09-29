// Frozen: a run's run-status.json as phax wrote it with `version: 1`, from
// its first definition through today (copied from src/schemas/status.ts at
// 233f1f18). `namespace` is optional: runs created before 803342b7 never
// recorded one.
// Pinned by hash in packages/schemas/history.lock.json — never edit.
// Self-contained: imports only effect, so later changes to phax's
// src/schemas cannot reach it.
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

export const RunStatusV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  namespace: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
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

export type RunStatusV1 = Schema.Schema.Type<typeof RunStatusV1Schema>;

export const decodeRunStatusV1 = Schema.decodeUnknownEither(RunStatusV1Schema);
