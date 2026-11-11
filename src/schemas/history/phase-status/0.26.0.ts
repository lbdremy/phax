// The frozen 0.26.0 shape of `phase-status`: the status.json phax 0.26.0
// through 0.32.x wrote, `$schema` first, with the `awaiting_review` state, the
// `mode` and the `stop`, whose corrected close names the `oracleStep`. Never
// edit this module: packages/schemas/history.lock.json pins its bytes. In
// phax, only src/schemas/persisted.ts may import it; the schemas package lists
// it as the format's 0.26.0 release.
import { Schema, SchemaTransformation } from "effect";

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
    /^https:\/\/docs\.phax\.run\/schemas\/phase-status\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The phase-status format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/phase-status/<X.Y.Z>.json",
  }),
);

const PhaseStateSchema = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("setting_up_worktree"),
  Schema.Literal("running"),
  Schema.Literal("gates_failed"),
  Schema.Literal("gates_exhausted"),
  Schema.Literal("fixing"),
  Schema.Literal("failed"),
  Schema.Literal("passed"),
  Schema.Literal("committed"),
  Schema.Literal("cleaning_up"),
  Schema.Literal("cleaned_up"),
  Schema.Literal("review_open"),
  Schema.Literal("handoff_failed"),
  Schema.Literal("skipped"),
  Schema.Literal("rate_limited"),
  Schema.Literal("awaiting_review"),
]);

const EffortSchema = Schema.Union([
  Schema.Literal("none"),
  Schema.Literal("off"),
  Schema.Literal("low"),
  Schema.Literal("medium"),
  Schema.Literal("high"),
  Schema.Literal("xhigh"),
  Schema.Literal("max"),
  Schema.Literal("ultracode"),
  Schema.Literal("ultra"),
]);

function isSafeBranchName(s: string): boolean {
  if (s.length === 0 || s[0] === "-") return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Reject ASCII control characters (0x00-0x1f), space (0x20), and DEL (0x7f).
    if (c <= 0x20 || c === 0x7f) return false;
  }
  return true;
}

const BranchNameSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.makeFilter(isSafeBranchName, {
    message: "branch name must not start with '-' or contain whitespace/control characters",
    toJsonSchema: () => ({ pattern: "^[^\\x00-\\x20\\x7f-][^\\x00-\\x20\\x7f]*$" }),
  }),
).pipe(Schema.brand("BranchName"));

const FullCommitShaSchema = Schema.String.check(
  isExportedPattern(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
).pipe(
  Schema.annotate({
    description: "A commit's full object name: 40 lowercase hex digits (SHA-1) or 64 (SHA-256).",
  }),
);

const PhaseModeSchema = Schema.Literals(["headless", "interactive"]);

// A stop refuses any key it does not name: every other name is a rest of
// `never`, refused as the unexpected key it is, on the encoded side only, so
// the decoded type is the struct's own. The annotation key is the one
// src/schemas/refusal/adapter.ts reads, written out here because a frozen
// module imports only effect.
function closed<S extends Schema.Struct<Schema.Struct.Fields>>(struct: S) {
  const keys = Object.keys(struct.fields);
  const expected = keys.map((key) => JSON.stringify(key)).join(" | ");
  const otherKey = Schema.String.check(
    Schema.makeFilter((key: string) => !keys.includes(key), {
      toJsonSchema: () => ({ not: { enum: keys } }),
    }),
  );
  const unexpected = Schema.Never.annotate({
    phaxRefusalOverride: () => `is unexpected, expected: ${expected}`,
  });
  // Its JSON Schema names the keys: a document rendered leaving unknown keys
  // open drops the rest, so a check that refuses nothing when decoding closes it.
  const namesItsKeys = Schema.makeFilter(() => true, {
    toJsonSchema: () => ({ propertyNames: { enum: keys } }),
  });
  return Schema.StructWithRest(struct, [Schema.Record(otherKey, unexpected)]).check(namesItsKeys).pipe(
    // The value passes unchanged: the rest refused every other key, so what
    // decoded is exactly the struct (Effect cannot see that through the generic).
    Schema.decodeTo(struct, SchemaTransformation.passthrough({ strict: false })),
  );
}

const ClosedBySchema = closed(
  Schema.Struct({
    name: Schema.NonEmptyString,
    email: Schema.NonEmptyString,
  }).annotate({
    description:
      "The git identity of the checkout that closed the stop, read from its configuration and never from a commit.",
  }),
);

const OracleStepSchema = Schema.Literals(["authored", "none"]).annotate({
  description:
    "Whether the close's gate ended with the `authored` oracle step, which passed, since the close committed.",
});

const PhaseStopSchema = Schema.NullOr(
  Schema.Union([
    closed(
      Schema.Struct({
        cause: Schema.Literal("declared"),
        status: Schema.Literal("waiting"),
      }),
    ),
    closed(
      Schema.Struct({
        cause: Schema.Literal("declared"),
        status: Schema.Literal("closed"),
        outcome: Schema.Literal("corrected"),
        oracleStep: OracleStepSchema,
        closedBy: ClosedBySchema,
      }),
    ),
    closed(
      Schema.Struct({
        cause: Schema.Literal("declared"),
        status: Schema.Literal("closed"),
        outcome: Schema.Literal("unchanged"),
        closedBy: ClosedBySchema,
      }),
    ),
    closed(
      Schema.Struct({
        cause: Schema.Literal("held"),
        status: Schema.Literal("waiting"),
      }),
    ),
    closed(
      Schema.Struct({
        cause: Schema.Literal("held"),
        status: Schema.Literal("closed"),
        outcome: Schema.Literal("corrected"),
        reviewCommit: FullCommitShaSchema,
        oracleStep: OracleStepSchema,
        closedBy: ClosedBySchema,
      }),
    ),
    closed(
      Schema.Struct({
        cause: Schema.Literal("held"),
        status: Schema.Literal("closed"),
        outcome: Schema.Literal("unchanged"),
        closedBy: ClosedBySchema,
      }),
    ),
  ]),
);

export const PhaseStatusV0_26_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  phaseId: Schema.NonEmptyString,
  phaseIndex: Schema.Number,
  state: PhaseStateSchema,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  branchName: BranchNameSchema,
  base: FullCommitShaSchema.annotate({
    description:
      "The full object name of the commit this phase's branch was created from, noted when phax created the branch.",
  }),
  worktreePath: Schema.optionalKey(Schema.NonEmptyString),
  claudeSessionId: Schema.optionalKey(Schema.NonEmptyString),
  commitHash: Schema.optionalKey(Schema.NonEmptyString),
  mode: PhaseModeSchema,
  stop: PhaseStopSchema,
});

export type PhaseStatusV0_26_0 = Schema.Schema.Type<typeof PhaseStatusV0_26_0Schema>;

/** Ignores unknown keys except on the stop, which names its own. */
export const decodePhaseStatusV0_26_0 = Schema.decodeUnknownResult(PhaseStatusV0_26_0Schema, {
  reportInput: true,
});
