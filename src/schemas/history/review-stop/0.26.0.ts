// The frozen 0.26.0 shape of `review-stop`: the review-stop.json phax 0.26.0
// through 0.29.x wrote while a run was `awaiting_review`, `$schema` first, two
// variants told apart by `cause`. Its `lastClose` has no `network` result.
// Born with `$schema`; every key is required and any other key is refused.
// Never edit this module: packages/schemas/history.lock.json pins its bytes. In
// phax, only src/schemas/persisted.ts may import it; the schemas package lists
// it as the format's 0.26.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/review-stop\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The review-stop format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/review-stop/<X.Y.Z>.json",
  }),
);

const ProviderIdSchema = Schema.Union(
  Schema.Literal("claude-code"),
  Schema.Literal("codex-cli"),
  Schema.Literal("mistral-vibe"),
);

const FullCommitShaSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
  Schema.annotations({
    description: "A commit's full object name: 40 lowercase hex digits (SHA-1) or 64 (SHA-256).",
  }),
);

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

/** A 0.26.0 `review-stop` document, the declared variant. */
const DeclaredReviewStopV0_26_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
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

/** A 0.26.0 `review-stop` document, the held variant. */
const HeldReviewStopV0_26_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
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

/** A 0.26.0 `review-stop` document: the declared variant or the held one. */
export const ReviewStopV0_26_0Schema = Schema.Union(
  DeclaredReviewStopV0_26_0Schema,
  HeldReviewStopV0_26_0Schema,
).annotations(strictKeys);

export type ReviewStopV0_26_0 = Schema.Schema.Type<typeof ReviewStopV0_26_0Schema>;

export const decodeReviewStopV0_26_0 = Schema.decodeUnknownEither(ReviewStopV0_26_0Schema, {
  onExcessProperty: "error",
});
