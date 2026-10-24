import { Schema, type Types } from "effect";
import { PhaseModeSchema } from "./phaxPlan.js";
import { ProviderIdSchema } from "./providerId.js";
import { schemaUrlField } from "./schemaUrl.js";
import { FullCommitShaSchema } from "./status.js";
import { RecordedSurfaceSchema } from "./surface.js";

/**
 * Full = skeleton plus `output.jsonl`. Skeleton is produced both when the
 * transcript is turned off and when the provider produced no transcript.
 */
export const RecordShapeSchema = Schema.Union(Schema.Literal("full"), Schema.Literal("skeleton"));

export type RecordShape = Schema.Schema.Type<typeof RecordShapeSchema>;

/**
 * Mirrors spec §5.1's own wording for how a phase ends: committed, or one of
 * the three ways it can end without a commit (failed, abandoned, interrupted).
 */
export const RecordPhaseOutcomeSchema = Schema.Union(
  Schema.Literal("committed"),
  Schema.Literal("failed"),
  Schema.Literal("abandoned"),
  Schema.Literal("interrupted"),
);

export type RecordPhaseOutcome = Schema.Schema.Type<typeof RecordPhaseOutcomeSchema>;

export const ClaudeTokenUsageSchema = Schema.Struct({
  provider: Schema.Literal("claude-code"),
  inputTokens: Schema.Number,
  cacheCreationInputTokens: Schema.Number,
  cacheReadInputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalCostUsd: Schema.Number,
});

export type ClaudeTokenUsage = Schema.Schema.Type<typeof ClaudeTokenUsageSchema>;

export const CodexTokenUsageSchema = Schema.Struct({
  provider: Schema.Literal("codex-cli"),
  inputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  outputTokens: Schema.Number,
  reasoningOutputTokens: Schema.Number,
});

export type CodexTokenUsage = Schema.Schema.Type<typeof CodexTokenUsageSchema>;

/**
 * vibe carries no usage in its transcript stream; this is read from the
 * session's `meta.json` `.stats` object instead (see
 * `findVibeSessionId` in `src/schemas/vibeOutput.ts` for how the session
 * directory is located). It is the richest of the three sources: it also
 * carries tool-call agreement stats nothing else exposes.
 */
export const VibeTokenUsageSchema = Schema.Struct({
  provider: Schema.Literal("mistral-vibe"),
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  sessionCostUsd: Schema.Number,
  toolCallsAgreed: Schema.Number,
  toolCallsRejected: Schema.Number,
  toolCallsFailed: Schema.Number,
  toolCallsSucceeded: Schema.Number,
});

export type VibeTokenUsage = Schema.Schema.Type<typeof VibeTokenUsageSchema>;

export const ProviderTokenUsageSchema = Schema.Union(
  ClaudeTokenUsageSchema,
  CodexTokenUsageSchema,
  VibeTokenUsageSchema,
);

export type ProviderTokenUsage = Schema.Schema.Type<typeof ProviderTokenUsageSchema>;

/**
 * Token usage is a declared-optional value, not a number that defaults to
 * zero: reporting an unavailable usage as `0` is the failure this shape
 * exists to prevent (spec §5.5).
 */
export const TokenUsageSchema = Schema.Union(
  Schema.Struct({ available: Schema.Literal(true), usage: ProviderTokenUsageSchema }),
  Schema.Struct({ available: Schema.Literal(false) }),
);

export type TokenUsage = Schema.Schema.Type<typeof TokenUsageSchema>;

export const UNAVAILABLE_TOKEN_USAGE: TokenUsage = { available: false };

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

/**
 * The phase's role in an oracle pair: null when it is in none; `oracle` for
 * the phase that authors the tests, naming the phase that discharges them;
 * `discharging` for the phase that discharges them, naming the oracle phase.
 */
export const RecordOracleRoleSchema = Schema.NullOr(
  Schema.Union(
    Schema.Struct({ role: Schema.Literal("oracle"), dischargedBy: PhaseIdSchema }),
    Schema.Struct({ role: Schema.Literal("discharging"), oraclePhase: PhaseIdSchema }),
  ),
);

export type RecordOracleRole = Schema.Schema.Type<typeof RecordOracleRoleSchema>;

const RecordClosedBySchema = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
}).annotations({
  description: "The git identity of the checkout that closed the stop.",
});

/** How a recorded session's transcript came out at the close: its digest, never its content. */
const RecordTranscriptSchema = Schema.Union(
  Schema.Struct({
    status: Schema.Literal("captured"),
    sha256: Schema.String.pipe(
      Schema.pattern(/^[0-9a-f]{64}$/),
      Schema.annotations({ description: "The sha256 of the transcript copy's bytes." }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("missing"),
    reason: Schema.Literal("not-found", "unreadable"),
    detail: Schema.NonEmptyString,
  }),
);

/** A session the stop recorded: the builder, a first turn that answered, or a `--new-session` one. */
const RecordStopSessionSchema = Schema.Struct({
  provider: ProviderIdSchema,
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  sessionId: Schema.NonEmptyString,
  origin: Schema.Literal("first-turn", "new-session", "builder"),
  transcript: RecordTranscriptSchema,
});

export type RecordStopSession = Schema.Schema.Type<typeof RecordStopSessionSchema>;

const stopRecordFields = {
  closedBy: RecordClosedBySchema,
  sessions: Schema.Array(RecordStopSessionSchema),
};

/**
 * The phase's stop: null for a phase that never stopped, else its cause, its
 * outcome, who closed it and its recorded sessions. Only a held close that
 * corrected something names its review commit.
 */
export const RecordStopSchema = Schema.NullOr(
  Schema.Union(
    Schema.Struct({
      cause: Schema.Literal("declared"),
      outcome: Schema.Literal("corrected"),
      ...stopRecordFields,
    }),
    Schema.Struct({
      cause: Schema.Literal("declared"),
      outcome: Schema.Literal("unchanged"),
      ...stopRecordFields,
    }),
    Schema.Struct({
      cause: Schema.Literal("held"),
      outcome: Schema.Literal("corrected"),
      reviewCommit: FullCommitShaSchema,
      ...stopRecordFields,
    }),
    Schema.Struct({
      cause: Schema.Literal("held"),
      outcome: Schema.Literal("unchanged"),
      ...stopRecordFields,
    }),
  ),
);

export type RecordStop = Schema.Schema.Type<typeof RecordStopSchema>;

/**
 * The record manifest (`record.json`): everything about a phase's record
 * except the artifacts it carries. The source sha is a back-reference that
 * may go stale (rebase, squash merge) and is absent for a phase that never
 * committed — it is never the record's address, which is `runId` + `phaseId`.
 */
const runRecordManifestFields = {
  runId: Schema.NonEmptyString,
  phaseId: Schema.NonEmptyString,
  shape: RecordShapeSchema,
  sourceSha: Schema.optional(Schema.NonEmptyString),
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  provider: ProviderIdSchema,
  outcome: RecordPhaseOutcomeSchema,
  usage: TokenUsageSchema,
  verifiedSurfaces: Schema.Array(RecordedSurfaceSchema),
  oracle: RecordOracleRoleSchema,
  mode: PhaseModeSchema,
  stop: RecordStopSchema,
};

/** A phase record manifest in memory: never a `version`, never a `$schema`. */
export type RunRecordManifest = Types.Simplify<Schema.Struct.Type<typeof runRecordManifestFields>>;

/**
 * A phase record's `record.json` as phax writes it: `$schema` first, then the
 * manifest's fields. Unknown keys are rejected.
 */
export const RunRecordManifestFileSchema = Schema.Struct({
  $schema: schemaUrlField("phase-record-manifest"),
  ...runRecordManifestFields,
});

export type RunRecordManifestFile = Schema.Schema.Type<typeof RunRecordManifestFileSchema>;

export const decodeRunRecordManifestFile = Schema.decodeUnknownEither(RunRecordManifestFileSchema, {
  onExcessProperty: "error",
});

export const encodeRunRecordManifest = Schema.encodeSync(RunRecordManifestFileSchema);
