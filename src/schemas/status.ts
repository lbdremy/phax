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
);

const PhaseStateSchema = Schema.Union(
  Schema.Literal("pending"),
  Schema.Literal("setting_up_worktree"),
  Schema.Literal("running"),
  Schema.Literal("gates_failed"),
  Schema.Literal("fixing"),
  Schema.Literal("failed"),
  Schema.Literal("passed"),
  Schema.Literal("committed"),
  Schema.Literal("cleaning_up"),
  Schema.Literal("cleaned_up"),
  Schema.Literal("review_open"),
  Schema.Literal("handoff_failed"),
  Schema.Literal("skipped"),
);

const EffortSchema = Schema.Union(
  Schema.Literal("low"),
  Schema.Literal("medium"),
  Schema.Literal("high"),
);

export const RunStatusSchema = Schema.Struct({
  version: Schema.Literal(1),
  shortName: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  state: RunStateSchema,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  phasesCount: Schema.Number,
  currentPhaseIndex: Schema.optionalWith(Schema.Number, { exact: true }),
  gateProfileId: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
});

export type RunStatus = Schema.Schema.Type<typeof RunStatusSchema>;

export const decodeRunStatus = Schema.decodeUnknownEither(RunStatusSchema);
export const encodeRunStatus = Schema.encodeSync(RunStatusSchema);

export const PhaseStatusSchema = Schema.Struct({
  version: Schema.Literal(1),
  phaseId: Schema.NonEmptyString,
  phaseIndex: Schema.Number,
  state: PhaseStateSchema,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  worktreePath: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  claudeSessionId: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  commitHash: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
});

export type PhaseStatus = Schema.Schema.Type<typeof PhaseStatusSchema>;

export const decodePhaseStatus = Schema.decodeUnknownEither(PhaseStatusSchema);
export const encodePhaseStatus = Schema.encodeSync(PhaseStatusSchema);
