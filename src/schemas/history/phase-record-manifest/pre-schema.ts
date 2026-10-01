// The frozen pre-schema shape of `phase-record-manifest`: exactly what phax
// wrote before it wrote `$schema` (the `version: 2` manifest). Never edit this
// module: packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
import { Schema } from "effect";

const ProviderIdSchema = Schema.Union(
  Schema.Literal("claude-code"),
  Schema.Literal("codex-cli"),
  Schema.Literal("mistral-vibe"),
);

const SurfaceSchema = Schema.Literal("local", "structural", "product");

const RecordShapeSchema = Schema.Union(Schema.Literal("full"), Schema.Literal("skeleton"));

const RecordPhaseOutcomeSchema = Schema.Union(
  Schema.Literal("committed"),
  Schema.Literal("failed"),
  Schema.Literal("abandoned"),
  Schema.Literal("interrupted"),
);

const ClaudeTokenUsageSchema = Schema.Struct({
  provider: Schema.Literal("claude-code"),
  inputTokens: Schema.Number,
  cacheCreationInputTokens: Schema.Number,
  cacheReadInputTokens: Schema.Number,
  outputTokens: Schema.Number,
  totalCostUsd: Schema.Number,
});

const CodexTokenUsageSchema = Schema.Struct({
  provider: Schema.Literal("codex-cli"),
  inputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  outputTokens: Schema.Number,
  reasoningOutputTokens: Schema.Number,
});

const VibeTokenUsageSchema = Schema.Struct({
  provider: Schema.Literal("mistral-vibe"),
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  sessionCostUsd: Schema.Number,
  toolCallsAgreed: Schema.Number,
  toolCallsRejected: Schema.Number,
  toolCallsFailed: Schema.Number,
  toolCallsSucceeded: Schema.Number,
});

const ProviderTokenUsageSchema = Schema.Union(
  ClaudeTokenUsageSchema,
  CodexTokenUsageSchema,
  VibeTokenUsageSchema,
);

const TokenUsageSchema = Schema.Union(
  Schema.Struct({ available: Schema.Literal(true), usage: ProviderTokenUsageSchema }),
  Schema.Struct({ available: Schema.Literal(false) }),
);

export const PhaseRecordManifestPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(2),
  runId: Schema.NonEmptyString,
  phaseId: Schema.NonEmptyString,
  shape: RecordShapeSchema,
  sourceSha: Schema.optional(Schema.NonEmptyString),
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  provider: ProviderIdSchema,
  outcome: RecordPhaseOutcomeSchema,
  usage: TokenUsageSchema,
  verifiedSurfaces: Schema.Array(SurfaceSchema),
});

export type PhaseRecordManifestPreSchema = Schema.Schema.Type<
  typeof PhaseRecordManifestPreSchemaSchema
>;

export const decodePhaseRecordManifestPreSchema = Schema.decodeUnknownEither(
  PhaseRecordManifestPreSchemaSchema,
  { onExcessProperty: "error" },
);
