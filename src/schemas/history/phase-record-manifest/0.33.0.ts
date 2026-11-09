// The frozen 0.33.0 shape of `phase-record-manifest`: the `record.json` phax
// 0.33.0 through 0.33.x wrote for a phase, `$schema` first, with the
// `acceptance` role (`acceptance` naming `passedBy`, `passing` naming
// `acceptancePhase`), the `acceptance` verified surface, the `mode` and the
// `stop`. A Vibe session's usage is its input, cached input and output tokens
// and its cost. Never edit this module: packages/schemas/history.lock.json pins
// its bytes. In phax, only src/schemas/persisted.ts may import it. The schemas
// package lists it as the format's 0.33.0 release.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

const SchemaUrlSchema = Schema.String.check(
  isExportedPattern(
    /^https:\/\/docs\.phax\.run\/schemas\/phase-record-manifest\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The phase-record-manifest format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/phase-record-manifest/<X.Y.Z>.json",
  }),
);

const ProviderIdSchema = Schema.Union([
  Schema.Literal("claude-code"),
  Schema.Literal("codex-cli"),
  Schema.Literal("mistral-vibe"),
]);

const RecordShapeSchema = Schema.Union([Schema.Literal("full"), Schema.Literal("skeleton")]);

const RecordPhaseOutcomeSchema = Schema.Union([
  Schema.Literal("committed"),
  Schema.Literal("failed"),
  Schema.Literal("abandoned"),
  Schema.Literal("interrupted"),
]);

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
  cachedInputTokens: Schema.Number,
  outputTokens: Schema.Number,
  costUsd: Schema.Number,
});

const ProviderTokenUsageSchema = Schema.Union([
  ClaudeTokenUsageSchema,
  CodexTokenUsageSchema,
  VibeTokenUsageSchema,
]);

const TokenUsageSchema = Schema.Union([
  Schema.Struct({ available: Schema.Literal(true), usage: ProviderTokenUsageSchema }),
  Schema.Struct({ available: Schema.Literal(false) }),
]);

const PhaseIdSchema = Schema.String.check(isExportedPattern(/^phase-\d{2}$/));

const RecordAcceptanceRoleSchema = Schema.NullOr(
  Schema.Union([
    Schema.Struct({ role: Schema.Literal("acceptance"), passedBy: PhaseIdSchema }),
    Schema.Struct({ role: Schema.Literal("passing"), acceptancePhase: PhaseIdSchema }),
  ]),
);

const RecordedSurfaceSchema = Schema.Literals(["local", "structural", "product", "acceptance"]);

const PhaseModeSchema = Schema.Literals(["headless", "interactive"]);

const FullCommitShaSchema = Schema.String.check(
  isExportedPattern(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
).pipe(
  Schema.annotate({
    description: "A commit's full object name: 40 lowercase hex digits (SHA-1) or 64 (SHA-256).",
  }),
);

const SafeSessionIdSchema = Schema.String.check(
  isExportedPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
).pipe(
  Schema.annotate({
    identifier: "SafeSessionId",
    description:
      "A provider session id: a letter or digit, then letters, digits, `.`, `_` or `-`. `.`, `..` and any slash are refused.",
  }),
);

const RecordClosedBySchema = Schema.Struct({
  name: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
}).annotate({
  description: "The git identity of the checkout that closed the stop.",
});

const RecordTranscriptSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("captured"),
    sha256: Schema.String.check(isExportedPattern(/^[0-9a-f]{64}$/)).pipe(
      Schema.annotate({ description: "The sha256 of the transcript copy's bytes." }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literal("missing"),
    reason: Schema.Literals(["not-found", "unreadable"]),
    detail: Schema.NonEmptyString,
  }),
]);

const RecordStopSessionSchema = Schema.Struct({
  provider: ProviderIdSchema,
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  sessionId: SafeSessionIdSchema,
  origin: Schema.Literals(["first-turn", "new-session", "builder"]),
  transcript: RecordTranscriptSchema,
});

const stopRecordFields = {
  closedBy: RecordClosedBySchema,
  sessions: Schema.Array(RecordStopSessionSchema),
};

const RecordStopSchema = Schema.NullOr(
  Schema.Union([
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
  ]),
);

export const PhaseRecordManifestV0_33_0Schema = Schema.Struct({
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
  verifiedSurfaces: Schema.Array(RecordedSurfaceSchema),
  acceptance: RecordAcceptanceRoleSchema,
  mode: PhaseModeSchema,
  stop: RecordStopSchema,
});

export type PhaseRecordManifestV0_33_0 = Schema.Schema.Type<
  typeof PhaseRecordManifestV0_33_0Schema
>;

export const decodePhaseRecordManifestV0_33_0 = Schema.decodeUnknownResult(
  PhaseRecordManifestV0_33_0Schema,
  { onExcessProperty: "error", reportInput: true },
);
