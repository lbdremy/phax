// The `interactive-session` document: `<run folder>/<phase-id>/interactive-session.json`,
// the sessions recorded for a declared interactive phase and every first
// turn phax ran. Born with `$schema`; every key is required, every variant
// has exactly its own keys, and any other key is refused.
import { Schema } from "effect";
import { ProviderIdSchema } from "./providerId.js";
import { schemaUrlField } from "./schemaUrl.js";

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

const InstantSchema = Schema.NonEmptyString.annotations({ description: "An ISO-8601 instant." });

const OriginSchema = Schema.Literal("first-turn", "new-session").annotations({
  description: "How the session began: the first turn, or `phax enter-phase --new-session`.",
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
  origin: OriginSchema,
});

const FirstTurnSchema = Schema.Union(
  Schema.Struct({
    outcome: Schema.Literal("answered"),
    origin: OriginSchema,
    startedAt: InstantSchema,
    endedAt: InstantSchema,
    sessionId: Schema.NonEmptyString,
  }),
  Schema.Struct({
    outcome: Schema.Literal("refused-change"),
    origin: OriginSchema,
    startedAt: InstantSchema,
    endedAt: InstantSchema,
    changedPaths: Schema.NonEmptyArray(Schema.String),
    keptAt: Schema.NonEmptyString.annotations({
      description: "The folder holding the turn's versions of the changed paths.",
    }),
  }),
  Schema.Struct({
    outcome: Schema.Literal("failed"),
    origin: OriginSchema,
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

const TurnInProgressSchema = Schema.Struct({
  turn: Schema.Int.pipe(Schema.between(1, 99)),
  origin: OriginSchema,
  beforeTree: Schema.NonEmptyString.annotations({
    description: "The worktree's tree id before the turn.",
  }),
  personHandoffBefore: Schema.NullOr(Sha256Schema).annotations({
    description: "The sha256 of the person's handoff file before the turn, or null if absent.",
  }),
  startedAt: InstantSchema,
});

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
});

export type InteractiveSessionFile = Schema.Schema.Type<typeof InteractiveSessionFileSchema>;

/** An interactive session document, without `$schema`. */
export type InteractiveSession = Omit<InteractiveSessionFile, "$schema">;

export const decodeInteractiveSessionFile = Schema.decodeUnknownEither(
  InteractiveSessionFileSchema,
  { onExcessProperty: "error" },
);

export const encodeInteractiveSessionFile = Schema.encodeSync(InteractiveSessionFileSchema);
