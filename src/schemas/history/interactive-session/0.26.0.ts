// The frozen 0.26.0 shape of `interactive-session`: the interactive-session.json
// phax 0.26.0 through 0.29.x wrote for a declared interactive phase, `$schema`
// first. A held phase's `builderUsage` is read at the hold point; a Vibe
// session's usage is its input and output tokens, its session cost and four
// tool-call counts. Born with `$schema`; every key is required and any other
// key is refused. Never edit this module: packages/schemas/history.lock.json
// pins its bytes. In phax, only src/schemas/persisted.ts may import it; the
// schemas package lists it as the format's 0.26.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/interactive-session\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The interactive-session format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/interactive-session/<X.Y.Z>.json",
  }),
);

const ProviderIdSchema = Schema.Union(
  Schema.Literal("claude-code"),
  Schema.Literal("codex-cli"),
  Schema.Literal("mistral-vibe"),
);

const SafeSessionIdSchema = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  Schema.annotations({
    identifier: "SafeSessionId",
    description:
      "A provider session id: a letter or digit, then letters, digits, `.`, `_` or `-`. `.`, `..` and any slash are refused.",
  }),
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

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

const InstantSchema = Schema.NonEmptyString.annotations({ description: "An ISO-8601 instant." });

const FirstTurnOriginSchema = Schema.Literal("first-turn", "new-session").annotations({
  description:
    "How a first turn's session began: the first turn, or `phax enter-phase --new-session`. A first turn is never the builder.",
});

const SessionOriginSchema = Schema.Literal("first-turn", "new-session", "builder").annotations({
  description:
    "How the session began: the first turn, `phax enter-phase --new-session`, or the builder session of a held headless phase.",
});

const Sha256Schema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{64}$/),
  Schema.annotations({ description: "A sha256 hex digest." }),
);

const SessionSchema = Schema.Struct({
  provider: ProviderIdSchema,
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  sessionId: SafeSessionIdSchema,
  startedAt: InstantSchema,
  origin: SessionOriginSchema,
});

const FirstTurnSchema = Schema.Union(
  Schema.Struct({
    outcome: Schema.Literal("answered"),
    origin: FirstTurnOriginSchema,
    startedAt: InstantSchema,
    endedAt: InstantSchema,
    sessionId: SafeSessionIdSchema,
  }),
  Schema.Struct({
    outcome: Schema.Literal("refused-change"),
    origin: FirstTurnOriginSchema,
    startedAt: InstantSchema,
    endedAt: InstantSchema,
    changedPaths: Schema.NonEmptyArray(Schema.String),
    keptAt: Schema.NonEmptyString.annotations({
      description: "The folder holding the turn's versions of the changed paths.",
    }),
  }),
  Schema.Struct({
    outcome: Schema.Literal("failed"),
    origin: FirstTurnOriginSchema,
    startedAt: InstantSchema,
    endedAt: InstantSchema,
    reason: Schema.Literal(
      "rate-limit",
      "usage-limit",
      "provider-error",
      "invalid-answer",
      "interrupted",
    ),
    detail: Schema.NonEmptyString,
    resetAt: Schema.NullOr(Schema.String),
  }),
);

const turnInProgressFields = {
  turn: Schema.Int.pipe(Schema.between(1, 99)),
  beforeTree: Schema.NonEmptyString.annotations({
    description: "The worktree's tree id before the turn.",
  }),
  personHandoffBefore: Schema.NullOr(Sha256Schema).annotations({
    description: "The sha256 of the person's handoff file before the turn, or null if absent.",
  }),
  startedAt: InstantSchema,
};

const TurnInProgressSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("first-turn").annotations({
      description: "A read-only first turn is in progress.",
    }),
    origin: FirstTurnOriginSchema,
    ...turnInProgressFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("closing-turn").annotations({
      description: "A stop's closing turn is in progress.",
    }),
    origin: SessionOriginSchema,
    ...turnInProgressFields,
  }),
);

const TranscriptEntrySchema = Schema.Union(
  Schema.Struct({
    sessionId: SafeSessionIdSchema,
    status: Schema.Literal("captured"),
    sha256: Sha256Schema.annotations({ description: "The sha256 of the copied file's bytes." }),
  }),
  Schema.Struct({
    sessionId: SafeSessionIdSchema,
    status: Schema.Literal("missing"),
    reason: Schema.Literal("not-found", "unreadable"),
    detail: Schema.NonEmptyString,
  }),
);

export const InteractiveSessionV0_26_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  phaseId: PhaseIdSchema,
  provider: ProviderIdSchema,
  interactiveResume: Schema.Literal("verified", "unverified").annotations({
    description: "Whether phax has verified that the provider resumes a session interactively.",
  }),
  current: Schema.NullOr(SessionSchema),
  history: Schema.Array(SessionSchema),
  firstTurns: Schema.Array(FirstTurnSchema),
  turnInProgress: Schema.NullOr(TurnInProgressSchema),
  transcripts: Schema.NullOr(Schema.Array(TranscriptEntrySchema)).annotations({
    description:
      "Null until a close copies the recorded sessions' transcripts, then one entry per recorded session.",
  }),
  builderUsage: Schema.NullOr(TokenUsageSchema).annotations({
    description:
      "A held phase's builder usage, read once at the hold point before any closing turn; null at a declared stop.",
  }),
});

export type InteractiveSessionV0_26_0 = Schema.Schema.Type<typeof InteractiveSessionV0_26_0Schema>;

export const decodeInteractiveSessionV0_26_0 = Schema.decodeUnknownEither(
  InteractiveSessionV0_26_0Schema,
  { onExcessProperty: "error" },
);
