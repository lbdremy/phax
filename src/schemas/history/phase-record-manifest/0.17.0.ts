// The frozen 0.17.0 shape of `phase-record-manifest`: the `record.json` phax
// 0.17.0 through 0.26.x wrote for a phase, `$schema` first, a three-value
// `verifiedSurfaces` and no `oracle` role.
// Never edit this module: packages/schemas/history.lock.json pins its bytes.
// In phax, only src/schemas/persisted.ts may import it. The schemas package
// lists it as the format's 0.17.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/phase-record-manifest\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The phase-record-manifest format and the phax release that wrote this file: https://docs.phax.run/schemas/phase-record-manifest/<X.Y.Z>.json",
  }),
);

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

export const PhaseRecordManifestV0_17_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
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

export type PhaseRecordManifestV0_17_0 = Schema.Schema.Type<
  typeof PhaseRecordManifestV0_17_0Schema
>;

export const decodePhaseRecordManifestV0_17_0 = Schema.decodeUnknownEither(
  PhaseRecordManifestV0_17_0Schema,
  { onExcessProperty: "error" },
);
