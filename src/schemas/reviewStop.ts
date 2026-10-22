// The `review-stop` document: `<run folder>/review-stop.json`, written exactly
// while a run is `awaiting_review`. A review UI reads it without running
// phax. Born with `$schema`; only the declared variant exists, every key is
// required and any other key is refused.
import { Schema } from "effect";
import { ProviderIdSchema } from "./providerId.js";
import { schemaUrlField } from "./schemaUrl.js";

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

const InstantSchema = Schema.NonEmptyString.annotations({ description: "An ISO-8601 instant." });

const CommandSchema = Schema.Struct({
  cwd: Schema.NonEmptyString,
  argv: Schema.NonEmptyArray(Schema.String),
  env: Schema.Record({ key: Schema.String, value: Schema.String }),
});

const LastCloseSchema = Schema.Union(
  Schema.Struct({
    result: Schema.Literal("gate-failed"),
    at: InstantSchema,
    exitCode: Schema.Literal(4),
    log: Schema.NonEmptyString,
  }),
  Schema.Struct({
    result: Schema.Literal("worktree-changed"),
    at: InstantSchema,
    exitCode: Schema.Literal(1),
    paths: Schema.NonEmptyArray(Schema.String),
  }),
  Schema.Struct({
    result: Schema.Literal("closing-turn-edited"),
    at: InstantSchema,
    exitCode: Schema.Literal(5),
    paths: Schema.NonEmptyArray(Schema.String),
  }),
  Schema.Struct({
    result: Schema.Literal("handoff-invalid"),
    at: InstantSchema,
    exitCode: Schema.Literal(1),
    defects: Schema.NonEmptyArray(Schema.String),
  }),
  Schema.Struct({
    result: Schema.Literal("closing-answer-invalid"),
    at: InstantSchema,
    exitCode: Schema.Literal(5),
    reason: Schema.NonEmptyString,
  }),
  Schema.Struct({
    result: Schema.Literal("limit"),
    at: InstantSchema,
    exitCode: Schema.Literal(8),
    resetAt: Schema.NullOr(Schema.String),
  }),
  // A provider error in the closing session exits 5; a Git, file or shell error exits 1.
  Schema.Struct({
    result: Schema.Literal("close-error"),
    at: InstantSchema,
    exitCode: Schema.Literal(5),
    step: Schema.Literal("closing-turn"),
    detail: Schema.NonEmptyString,
  }),
  Schema.Struct({
    result: Schema.Literal("close-error"),
    at: InstantSchema,
    exitCode: Schema.Literal(1),
    step: Schema.Literal("gate", "commit", "files"),
    detail: Schema.NonEmptyString,
  }),
  Schema.Struct({
    result: Schema.Literal("interrupted"),
    at: InstantSchema,
    exitCode: Schema.Literal(130),
  }),
);

/**
 * A `review-stop` document, the declared variant: a run stopped at a phase
 * the plan declared interactive. Exactly these keys; any other (a
 * `phaseCommit`, say) is refused.
 */
export const ReviewStopFileSchema = Schema.Struct({
  $schema: schemaUrlField("review-stop"),
  run: Schema.NonEmptyString.annotations({ description: "The run's qualified name." }),
  state: Schema.Literal("awaiting_review"),
  cause: Schema.Literal("declared"),
  phase: Schema.Struct({
    id: PhaseIdSchema,
    title: Schema.NonEmptyString,
    mode: Schema.Literal("interactive"),
    position: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
    of: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
  }),
  firstReading: Schema.NullOr(Schema.String).annotations({
    description: "The path of first-reading.md, or null when no first turn answered.",
  }),
  worktree: Schema.NonEmptyString,
  seed: Schema.NonEmptyString,
  session: Schema.NullOr(
    Schema.Struct({
      provider: ProviderIdSchema,
      sessionId: Schema.NonEmptyString,
      origin: Schema.Literal("first-turn", "new-session"),
      interactiveResume: Schema.Literal("verified", "unverified"),
    }),
  ),
  commands: Schema.Struct({
    continue: Schema.NullOr(CommandSchema),
    freshStart: CommandSchema,
    enterPhase: CommandSchema,
    close: CommandSchema,
    reset: CommandSchema,
  }),
  lastClose: Schema.NullOr(LastCloseSchema),
  closeBase: Schema.NullOr(Schema.NonEmptyString).annotations({
    description: "The HEAD sha a close recorded before its gate, or null before any close.",
  }),
});

export type ReviewStopFile = Schema.Schema.Type<typeof ReviewStopFileSchema>;

/** A review stop, without `$schema`. */
export type ReviewStop = Omit<ReviewStopFile, "$schema">;

export type ReviewStopCommand = Schema.Schema.Type<typeof CommandSchema>;
export type LastClose = Schema.Schema.Type<typeof LastCloseSchema>;

export const decodeReviewStopFile = Schema.decodeUnknownEither(ReviewStopFileSchema, {
  onExcessProperty: "error",
});

export const encodeReviewStopFile = Schema.encodeSync(ReviewStopFileSchema);
