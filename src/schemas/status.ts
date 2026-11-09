import { Predicate, Result, Schema, SchemaIssue, type Types } from "effect";
import { BranchNameSchema } from "../domain/branded.js";
import { PhaseModeSchema } from "./phaxPlan.js";
import { schemaUrlField } from "./schemaUrl.js";
import { isExportedPattern } from "./strictString.js";

export const RunStateSchema = Schema.Union([
  Schema.Literal("created"),
  Schema.Literal("running"),
  Schema.Literal("failed"),
  Schema.Literal("review_open"),
  Schema.Literal("completed"),
  Schema.Literal("stopped"),
  Schema.Literal("archived"),
  Schema.Literal("interrupted"),
  Schema.Literal("rate_limited"),
  Schema.Literal("awaiting_review"),
]);

const PhaseStateSchema = Schema.Union([
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
  Schema.Literal("awaiting_review"),
]);

const EffortSchema = Schema.Union([
  Schema.Literal("none"),
  Schema.Literal("off"),
  Schema.Literal("low"),
  Schema.Literal("medium"),
  Schema.Literal("high"),
  Schema.Literal("xhigh"),
  Schema.Literal("max"),
  Schema.Literal("ultracode"),
  Schema.Literal("ultra"),
]);

const HoldPhasesSchema = Schema.NonEmptyArray(
  Schema.String.check(isExportedPattern(/^phase-\d{2}$/)),
);

/**
 * The hold resolved when the run was named, one struct per selection: `none`
 * holds nothing; the others list the held phases in plan order.
 */
export const RunHoldSchema = Schema.Union([
  Schema.Struct({ selection: Schema.Literal("none") }),
  Schema.Struct({ selection: Schema.Literal("all"), phases: HoldPhasesSchema }),
  Schema.Struct({ selection: Schema.Literal("listed"), phases: HoldPhasesSchema }),
  Schema.Struct({ selection: Schema.Literal("acceptance"), phases: HoldPhasesSchema }),
]);

export type RunHold = Schema.Schema.Type<typeof RunHoldSchema>;

const runStatusFields = {
  namespace: Schema.NonEmptyString,
  shortName: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  state: RunStateSchema,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  phasesCount: Schema.Number,
  currentPhaseIndex: Schema.optionalKey(Schema.Number),
  gateProfileId: Schema.optionalKey(Schema.NonEmptyString),
  // Why the run last stopped (e.g. "rate_limited"); surfaced by `session-info`.
  stoppedReason: Schema.optionalKey(Schema.NonEmptyString),
  // Human-readable description of the last error that stopped the run.
  lastError: Schema.optionalKey(Schema.NonEmptyString),
  // Repo-relative POSIX path of the plan that produced this run, recorded at run
  // creation so `phax resume` can re-supply it to the run-completion step (spec
  // 27) without re-deriving it. Optional: runs created before this field, and
  // loose plans with no lifecycle artifact, resume with completion skipped.
  planRepoRelPath: Schema.optionalKey(Schema.NonEmptyString),
  // Skill edit consent given at `phax run --allow-skill-edits`, recorded so
  // `phax resume` inherits it. Optional like `planRepoRelPath`: existing
  // run-status.json files must still decode, and absent means no consent.
  allowSkillEdits: Schema.optionalKey(Schema.Boolean),
  // The hold resolved when the run was named (`phax run --hold`; the CLI word
  // `acceptance` holds the acceptance phases) and never
  // changed, so every `phax resume` holds exactly these phases. Required: the
  // readers lift a run written before it to `none`.
  hold: RunHoldSchema,
};

/** A run's status in memory: never a `version`, never a `$schema`. */
export type RunStatus = Types.Simplify<Schema.Struct.Type<typeof runStatusFields>>;

/** `run-status.json` as phax writes it: `$schema` first, then the fields. Unknown keys are ignored. */
export const RunStatusFileSchema = Schema.Struct({
  $schema: schemaUrlField("run-status"),
  ...runStatusFields,
});

export type RunStatusFile = Schema.Schema.Type<typeof RunStatusFileSchema>;

export const decodeRunStatusFile = Schema.decodeUnknownResult(RunStatusFileSchema, {
  reportInput: true,
});
export const encodeRunStatus = Schema.encodeSync(RunStatusFileSchema);

/** A commit's full object name: 40 hex digits (SHA-1) or 64 (SHA-256). */
export const FullCommitShaSchema = Schema.String.check(
  isExportedPattern(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
).pipe(
  Schema.annotate({
    description: "A commit's full object name: 40 lowercase hex digits (SHA-1) or 64 (SHA-256).",
  }),
);

// The decoder refuses any other key on a stop (`decodePhaseStatusFile`), so
// the published JSON Schema does too, although the rest of status.json allows
// unknown keys. Effect's JSON Schema takes one excess-property strategy per
// document, so a stop names its keys: a check that refuses nothing when
// decoding, whose JSON Schema is `propertyNames`.
function closed<S extends Schema.Struct<Schema.Struct.Fields>>(struct: S) {
  const keys = Object.keys(struct.fields);
  return struct.check(
    Schema.makeFilter(() => true, { toJsonSchema: () => ({ propertyNames: { enum: keys } }) }),
  );
}

const ClosedBySchema = closed(
  Schema.Struct({
    name: Schema.NonEmptyString,
    email: Schema.NonEmptyString,
  }).annotate({
    description:
      "The git identity of the checkout that closed the stop, read from its configuration and never from a commit.",
  }),
);

const AcceptanceStepSchema = Schema.Literals(["authored", "none"]).annotate({
  description:
    "Whether the close's gate ended with the `authored` acceptance step, which passed, since the close committed.",
});

/**
 * A phase's stop: null for a phase that never stopped; `waiting` while it
 * waits for a person or its close runs; `closed` once the close finished,
 * with whether the person changed anything. One struct per cause and
 * outcome: a held close that corrected something names its review commit,
 * and a declared one never does.
 */
export const PhaseStopSchema = Schema.NullOr(
  Schema.Union([
    closed(
      Schema.Struct({
        cause: Schema.Literal("declared"),
        status: Schema.Literal("waiting"),
      }),
    ),
    closed(
      Schema.Struct({
        cause: Schema.Literal("declared"),
        status: Schema.Literal("closed"),
        outcome: Schema.Literal("corrected"),
        acceptanceStep: AcceptanceStepSchema,
        closedBy: ClosedBySchema,
      }),
    ),
    closed(
      Schema.Struct({
        cause: Schema.Literal("declared"),
        status: Schema.Literal("closed"),
        outcome: Schema.Literal("unchanged"),
        closedBy: ClosedBySchema,
      }),
    ),
    closed(
      Schema.Struct({
        cause: Schema.Literal("held"),
        status: Schema.Literal("waiting"),
      }),
    ),
    closed(
      Schema.Struct({
        cause: Schema.Literal("held"),
        status: Schema.Literal("closed"),
        outcome: Schema.Literal("corrected"),
        reviewCommit: FullCommitShaSchema,
        acceptanceStep: AcceptanceStepSchema,
        closedBy: ClosedBySchema,
      }),
    ),
    closed(
      Schema.Struct({
        cause: Schema.Literal("held"),
        status: Schema.Literal("closed"),
        outcome: Schema.Literal("unchanged"),
        closedBy: ClosedBySchema,
      }),
    ),
  ]),
);

export type PhaseStop = Schema.Schema.Type<typeof PhaseStopSchema>;

const phaseStatusFields = {
  phaseId: Schema.NonEmptyString,
  phaseIndex: Schema.Number,
  state: PhaseStateSchema,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  branchName: BranchNameSchema,
  base: FullCommitShaSchema.annotate({
    description:
      "The full object name of the commit this phase's branch was created from, noted when phax created the branch.",
  }),
  worktreePath: Schema.optionalKey(Schema.NonEmptyString),
  claudeSessionId: Schema.optionalKey(Schema.NonEmptyString),
  commitHash: Schema.optionalKey(Schema.NonEmptyString),
  // Copied from the plan phase when the status is first written.
  mode: PhaseModeSchema,
  stop: PhaseStopSchema,
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

const decodeLenientPhaseStatusFile = Schema.decodeUnknownResult(PhaseStatusFileSchema, {
  reportInput: true,
});
const decodeStrictStop = Schema.decodeUnknownResult(PhaseStopSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

/**
 * Decodes a `status.json`, ignoring unknown keys except on its stop: Effect 4
 * takes one excess-property strategy per decode, so the stop, once the file
 * decodes, is decoded again with `onExcessProperty: "error"`, and its first
 * violation is the file's, at `stop`.
 */
export const decodePhaseStatusFile = (
  input: unknown,
): Result.Result<PhaseStatusFile, Schema.SchemaError> => {
  const decoded = decodeLenientPhaseStatusFile(input);
  if (Result.isFailure(decoded) || !Predicate.hasProperty(input, "stop")) return decoded;
  const stop = decodeStrictStop(input.stop);
  return Result.isFailure(stop)
    ? Result.fail(new Schema.SchemaError(new SchemaIssue.Pointer(["stop"], stop.failure.issue)))
    : decoded;
};
export const encodePhaseStatus = Schema.encodeSync(PhaseStatusFileSchema);
