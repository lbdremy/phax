import { Schema } from "effect";
import { ProviderIdSchema } from "./providerId.js";

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

/**
 * The record manifest (`record.json`): everything about a phase's record
 * except the artifacts it carries. The source sha is a back-reference that
 * may go stale (rebase, squash merge) and is absent for a phase that never
 * committed — it is never the record's address, which is `runId` + `phaseId`.
 */
export const RunRecordManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  runId: Schema.NonEmptyString,
  phaseId: Schema.NonEmptyString,
  shape: RecordShapeSchema,
  sourceSha: Schema.optional(Schema.NonEmptyString),
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  provider: ProviderIdSchema,
  outcome: RecordPhaseOutcomeSchema,
  usage: TokenUsageSchema,
});

export type RunRecordManifest = Schema.Schema.Type<typeof RunRecordManifestSchema>;

export const decodeRunRecordManifest = Schema.decodeUnknownEither(RunRecordManifestSchema, {
  onExcessProperty: "error",
});

export const encodeRunRecordManifest = Schema.encodeSync(RunRecordManifestSchema);
