// The frozen 0.23.0 shape of `authoring-record-manifest`: the `record.json`
// phax 0.23.0 through 0.29.x wrote for a headless authoring session, `$schema`
// first, with the `retry` field. A Vibe session's usage is its input and
// output tokens, its session cost and four tool-call counts. Never edit this
// module: packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package lists it as the
// format's 0.23.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/authoring-record-manifest\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The authoring-record-manifest format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/authoring-record-manifest/<X.Y.Z>.json",
  }),
);

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

export const AuthoringRecordManifestV0_23_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  kind: Schema.Literal("authoring"),
  authoringId: Schema.NonEmptyString,
  artifact: Schema.NonEmptyString,
  artifactKind: Schema.Literal("spec", "plan"),
  shape: RecordShapeSchema,
  sourceSha: Schema.optional(Schema.NonEmptyString),
  provider: ProviderIdSchema,
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  outcome: Schema.Literal("committed", "failed"),
  retry: Schema.Literal("none", "retried"),
  usage: TokenUsageSchema,
});

export type AuthoringRecordManifestV0_23_0 = Schema.Schema.Type<
  typeof AuthoringRecordManifestV0_23_0Schema
>;

export const decodeAuthoringRecordManifestV0_23_0 = Schema.decodeUnknownEither(
  AuthoringRecordManifestV0_23_0Schema,
  { onExcessProperty: "error" },
);
