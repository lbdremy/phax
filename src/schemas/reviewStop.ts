// The `review-stop` document: `<run folder>/review-stop.json`, written exactly
// while a run is `awaiting_review`. A review UI reads it without running
// phax. Born with `$schema`; two variants told apart by `cause`, every key is
// required and any other key is refused.
import { Schema } from "effect";
import { ProviderIdSchema } from "./providerId.js";
import { schemaUrlField } from "./schemaUrl.js";
import { FullCommitShaSchema } from "./status.js";

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
  // A closing turn that could not reach the provider: `detail` is the provider's message.
  Schema.Struct({
    result: Schema.Literal("network"),
    at: InstantSchema,
    exitCode: Schema.Literal(14),
    detail: Schema.NonEmptyString,
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

const RunNameSchema = Schema.NonEmptyString.annotations({
  description: "The run's qualified name.",
});

const PositionSchema = Schema.Int.pipe(Schema.greaterThanOrEqualTo(1));

const CommandsSchema = Schema.Struct({
  continue: Schema.NullOr(CommandSchema),
  freshStart: CommandSchema,
  enterPhase: CommandSchema,
  close: CommandSchema,
  reset: CommandSchema,
});

const CloseBaseSchema = Schema.NullOr(Schema.NonEmptyString).annotations({
  description: "The HEAD sha a close recorded before its gate, or null before any close.",
});

const strictKeys = { parseOptions: { onExcessProperty: "error" } } as const;

// In both variants `cause` precedes `state`: `state` is the same literal in
// each, so a union parse that looks at it first cannot tell the variants
// apart, and reports the wrong variant's error for a defect in the right one.

/**
 * A `review-stop` document, the declared variant: a run stopped at a phase
 * the plan declared interactive. Exactly these keys; any other (a
 * `phaseCommit`, say) is refused.
 */
export const DeclaredReviewStopFileSchema = Schema.Struct({
  $schema: schemaUrlField("review-stop"),
  run: RunNameSchema,
  cause: Schema.Literal("declared"),
  state: Schema.Literal("awaiting_review"),
  phase: Schema.Struct({
    id: PhaseIdSchema,
    title: Schema.NonEmptyString,
    mode: Schema.Literal("interactive"),
    position: PositionSchema,
    of: PositionSchema,
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
  commands: CommandsSchema,
  lastClose: Schema.NullOr(LastCloseSchema),
  closeBase: CloseBaseSchema,
}).annotations(strictKeys);

/**
 * A `review-stop` document, the held variant: a run stopped after a headless
 * phase's commit because the operator held the phase. It names the phase
 * commit and has no `firstReading`: no first turn ran. Exactly these keys;
 * any other is refused.
 */
export const HeldReviewStopFileSchema = Schema.Struct({
  $schema: schemaUrlField("review-stop"),
  run: RunNameSchema,
  cause: Schema.Literal("held"),
  state: Schema.Literal("awaiting_review"),
  phase: Schema.Struct({
    id: PhaseIdSchema,
    title: Schema.NonEmptyString,
    mode: Schema.Literal("headless"),
    position: PositionSchema,
    of: PositionSchema,
  }),
  phaseCommit: FullCommitShaSchema.annotations({
    description: "The full object name of the phase's commit, which the stop holds.",
  }),
  worktree: Schema.NonEmptyString,
  seed: Schema.NonEmptyString,
  session: Schema.NullOr(
    Schema.Struct({
      provider: ProviderIdSchema,
      sessionId: Schema.NonEmptyString,
      origin: Schema.Literal("builder", "new-session"),
      interactiveResume: Schema.Literal("verified", "unverified"),
    }),
  ),
  commands: CommandsSchema,
  lastClose: Schema.NullOr(LastCloseSchema),
  closeBase: CloseBaseSchema,
}).annotations(strictKeys);

/** A `review-stop` document: the declared variant or the held one, told apart by `cause`. */
export const ReviewStopFileSchema = Schema.Union(
  DeclaredReviewStopFileSchema,
  HeldReviewStopFileSchema,
).annotations(strictKeys);

export type DeclaredReviewStopFile = Schema.Schema.Type<typeof DeclaredReviewStopFileSchema>;
export type HeldReviewStopFile = Schema.Schema.Type<typeof HeldReviewStopFileSchema>;
export type ReviewStopFile = Schema.Schema.Type<typeof ReviewStopFileSchema>;

/** A declared review stop, without `$schema`. */
export type DeclaredReviewStop = Omit<DeclaredReviewStopFile, "$schema">;

/** A held review stop, without `$schema`. */
export type HeldReviewStop = Omit<HeldReviewStopFile, "$schema">;

/** A review stop, without `$schema`. */
export type ReviewStop = DeclaredReviewStop | HeldReviewStop;

export type ReviewStopCommand = Schema.Schema.Type<typeof CommandSchema>;
export type LastClose = Schema.Schema.Type<typeof LastCloseSchema>;

export const decodeReviewStopFile = Schema.decodeUnknownEither(ReviewStopFileSchema, {
  onExcessProperty: "error",
});

export const encodeReviewStopFile = Schema.encodeSync(ReviewStopFileSchema);
