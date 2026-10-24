// The `interactive-session` document: `<run folder>/<phase-id>/interactive-session.json`,
// the sessions recorded for a declared interactive phase and every first
// turn phax ran. Born with `$schema`; every key is required, every variant
// has exactly its own keys, and any other key is refused.
import { Schema } from "effect";
import { ProviderIdSchema } from "./providerId.js";
import { schemaUrlField } from "./schemaUrl.js";

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
  sessionId: Schema.NonEmptyString,
  startedAt: InstantSchema,
  origin: SessionOriginSchema,
});

const FirstTurnSchema = Schema.Union(
  Schema.Struct({
    outcome: Schema.Literal("answered"),
    origin: FirstTurnOriginSchema,
    startedAt: InstantSchema,
    endedAt: InstantSchema,
    sessionId: Schema.NonEmptyString,
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

// A first turn is never the builder; a closing turn may resume the builder session.
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

// The outcome of copying one recorded session's transcript at a close.
const TranscriptEntrySchema = Schema.Union(
  Schema.Struct({
    sessionId: Schema.NonEmptyString,
    status: Schema.Literal("captured"),
    sha256: Sha256Schema.annotations({ description: "The sha256 of the copied file's bytes." }),
  }),
  Schema.Struct({
    sessionId: Schema.NonEmptyString,
    status: Schema.Literal("missing"),
    reason: Schema.Literal("not-found", "unreadable"),
    detail: Schema.NonEmptyString,
  }),
);

/**
 * An `interactive-session` document. Exactly the keys of its variants; any
 * other is refused.
 */
export const InteractiveSessionFileSchema = Schema.Struct({
  $schema: schemaUrlField("interactive-session"),
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
});

export type InteractiveSessionFile = Schema.Schema.Type<typeof InteractiveSessionFileSchema>;

/** An interactive session document, without `$schema`. */
export type InteractiveSession = Omit<InteractiveSessionFile, "$schema">;

export const decodeInteractiveSessionFile = Schema.decodeUnknownEither(
  InteractiveSessionFileSchema,
  { onExcessProperty: "error" },
);

export const encodeInteractiveSessionFile = Schema.encodeSync(InteractiveSessionFileSchema);
