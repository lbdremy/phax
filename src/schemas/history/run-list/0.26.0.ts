// The frozen 0.26.0 shape of `run-list`: what `phax ls --json` printed in phax
// 0.26.0 through 0.29.x, `$schema` first. A row's `stop` is the run's
// review-stop document at 0.26.0, inlined here because a frozen module imports
// only `effect`. Born with `$schema`; every key of a row is required and any
// other key is refused. Never edit this module: packages/schemas/history.lock.json
// pins its bytes. In phax, only src/schemas/persisted.ts may import it; the
// schemas package lists it as the format's 0.26.0 release.
import { Schema } from "effect";

const RunListSchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/run-list\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The run-list format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/run-list/<X.Y.Z>.json",
  }),
);

const ReviewStopSchemaUrlSchema = Schema.String.pipe(
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

const RunStateSchema = Schema.Union(
  Schema.Literal("created"),
  Schema.Literal("running"),
  Schema.Literal("failed"),
  Schema.Literal("review_open"),
  Schema.Literal("completed"),
  Schema.Literal("stopped"),
  Schema.Literal("archived"),
  Schema.Literal("interrupted"),
  Schema.Literal("rate_limited"),
  Schema.Literal("awaiting_review"),
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

const DeclaredReviewStopSchema = Schema.Struct({
  $schema: ReviewStopSchemaUrlSchema,
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

const HeldReviewStopSchema = Schema.Struct({
  $schema: ReviewStopSchemaUrlSchema,
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

const ReviewStopSchema = Schema.Union(DeclaredReviewStopSchema, HeldReviewStopSchema).annotations(
  strictKeys,
);

const RunListRowV0_26_0Schema = Schema.Struct({
  qualifiedName: Schema.NonEmptyString.annotations({
    description: "The run's qualified name: `<namespace>.<short name>`.",
  }),
  namespace: Schema.String,
  shortName: Schema.NonEmptyString,
  state: RunStateSchema,
  branch: Schema.String,
  currentPhase: Schema.NullOr(Schema.String).annotations({
    description: "The phase the run reached as `<n>/<total>`, or null when unknown.",
  }),
  gateProfile: Schema.NullOr(Schema.String).annotations({
    description: "The run's gate profile, or null when unknown.",
  }),
  updatedAt: Schema.String.annotations({
    description: "The run's last update, as `YYYY-MM-DD HH:MM`.",
  }),
  lockState: Schema.Literal("none", "active", "stale"),
  recordsPending: Schema.NullOr(Schema.Int.pipe(Schema.greaterThanOrEqualTo(0))).annotations({
    description: "The count of pending records, or null when records are off or not readable here.",
  }),
  archivePath: Schema.NullOr(Schema.String).annotations({
    description: "Where an archived run was moved, or null.",
  }),
  stop: Schema.NullOr(ReviewStopSchema).annotations({
    description:
      "The run's review-stop document while it awaits review; null when the run is not awaiting review, or when its review-stop document cannot be read.",
  }),
}).annotations(strictKeys);

/** A 0.26.0 `run-list` document: the rows of `phax ls --json`. */
export const RunListV0_26_0Schema = Schema.Struct({
  $schema: RunListSchemaUrlSchema,
  runs: Schema.Array(RunListRowV0_26_0Schema),
}).annotations(strictKeys);

export type RunListV0_26_0 = Schema.Schema.Type<typeof RunListV0_26_0Schema>;

export const decodeRunListV0_26_0 = Schema.decodeUnknownEither(RunListV0_26_0Schema, {
  onExcessProperty: "error",
});
