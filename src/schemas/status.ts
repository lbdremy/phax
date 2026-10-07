import { Schema, type Types } from "effect";
import { BranchNameSchema } from "../domain/branded.js";
import { schemaUrlField } from "./schemaUrl.js";

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

const PhaseStateSchema = Schema.Union(
  Schema.Literal("pending"),
  Schema.Literal("setting_up_worktree"),
  Schema.Literal("running"),
  Schema.Literal("gates_failed"),
  Schema.Literal("gates_exhausted"),
  Schema.Literal("fixing"),
  Schema.Literal("failed"),
  Schema.Literal("passed"),
  Schema.Literal("committed"),
  Schema.Literal("cleaning_up"),
  Schema.Literal("cleaned_up"),
  Schema.Literal("review_open"),
  Schema.Literal("handoff_failed"),
  Schema.Literal("skipped"),
  Schema.Literal("rate_limited"),
);

const EffortSchema = Schema.Union(
  Schema.Literal("none"),
  Schema.Literal("off"),
  Schema.Literal("low"),
  Schema.Literal("medium"),
  Schema.Literal("high"),
  Schema.Literal("xhigh"),
  Schema.Literal("max"),
  Schema.Literal("ultracode"),
  Schema.Literal("ultra"),
);

const runStatusFields = {
  namespace: Schema.NonEmptyString,
  shortName: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  state: RunStateSchema,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  phasesCount: Schema.Number,
  currentPhaseIndex: Schema.optionalWith(Schema.Number, { exact: true }),
  gateProfileId: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  // Why the run last stopped (e.g. "rate_limited"); surfaced by `session-info`.
  stoppedReason: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  // Human-readable description of the last error that stopped the run.
  lastError: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  // Repo-relative POSIX path of the plan that produced this run, recorded at run
  // creation so `phax resume` can re-supply it to the run-completion step (spec
  // 27) without re-deriving it. Optional: runs created before this field, and
  // loose plans with no lifecycle artifact, resume with completion skipped.
  planRepoRelPath: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  // Skill edit consent given at `phax run --allow-skill-edits`, recorded so
  // `phax resume` inherits it. Optional like `planRepoRelPath`: existing
  // run-status.json files must still decode, and absent means no consent.
  allowSkillEdits: Schema.optionalWith(Schema.Boolean, { exact: true }),
};

/** A run's status in memory: never a `version`, never a `$schema`. */
export type RunStatus = Types.Simplify<Schema.Struct.Type<typeof runStatusFields>>;

/** `run-status.json` as phax writes it: `$schema` first, then the fields. Unknown keys are ignored. */
export const RunStatusFileSchema = Schema.Struct({
  $schema: schemaUrlField("run-status"),
  ...runStatusFields,
});

export type RunStatusFile = Schema.Schema.Type<typeof RunStatusFileSchema>;

export const decodeRunStatusFile = Schema.decodeUnknownEither(RunStatusFileSchema);
export const encodeRunStatus = Schema.encodeSync(RunStatusFileSchema);

/** A commit's full object name: 40 hex digits (SHA-1) or 64 (SHA-256). */
export const FullCommitShaSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
  Schema.annotations({
    description: "A commit's full object name: 40 lowercase hex digits (SHA-1) or 64 (SHA-256).",
  }),
);

const phaseStatusFields = {
  phaseId: Schema.NonEmptyString,
  phaseIndex: Schema.Number,
  state: PhaseStateSchema,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  branchName: BranchNameSchema,
  base: FullCommitShaSchema.annotations({
    description:
      "The full object name of the commit this phase's branch was created from, noted when phax created the branch.",
  }),
  worktreePath: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  claudeSessionId: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  commitHash: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
};

/** A phase's status in memory: never a `version`, never a `$schema`. */
export type PhaseStatus = Types.Simplify<Schema.Struct.Type<typeof phaseStatusFields>>;

/**
 * A phase's `status.json` as phax writes it: `$schema` first, then the fields.
 * Unknown keys are ignored.
 */
export const PhaseStatusFileSchema = Schema.Struct({
  $schema: schemaUrlField("phase-status"),
  ...phaseStatusFields,
});

export type PhaseStatusFile = Schema.Schema.Type<typeof PhaseStatusFileSchema>;

export const decodePhaseStatusFile = Schema.decodeUnknownEither(PhaseStatusFileSchema);
export const encodePhaseStatus = Schema.encodeSync(PhaseStatusFileSchema);
