// The frozen pre-schema shape of `authoring-record-manifest`: exactly what
// phax wrote before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
import { Schema } from "effect";

const ProviderIdSchema = Schema.Union(
  Schema.Literal("claude-code"),
  Schema.Literal("codex-cli"),
  Schema.Literal("mistral-vibe"),
);

const RecordShapeSchema = Schema.Union(Schema.Literal("full"), Schema.Literal("skeleton"));

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

const AuthoringRecordOutcomeSchema = Schema.Literal("committed", "failed");

export const AuthoringRecordManifestPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("authoring"),
  authoringId: Schema.NonEmptyString,
  /** Repo-relative path of the artifact the session authored (or would have). */
  artifact: Schema.NonEmptyString,
  artifactKind: Schema.Literal("spec", "plan"),
  shape: RecordShapeSchema,
  sourceSha: Schema.optional(Schema.NonEmptyString),
  provider: ProviderIdSchema,
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  outcome: AuthoringRecordOutcomeSchema,
  usage: TokenUsageSchema,
});

export type AuthoringRecordManifestPreSchema = Schema.Schema.Type<
  typeof AuthoringRecordManifestPreSchemaSchema
>;

export const decodeAuthoringRecordManifestPreSchema = Schema.decodeUnknownEither(
  AuthoringRecordManifestPreSchemaSchema,
  { onExcessProperty: "error" },
);
