// The frozen 0.17.0 shape of `phase-status`: the status.json phax 0.17.0
// through 0.19.x wrote, `$schema` first and no `base`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. phax itself never imports
// it; the schemas package lists it as the format's 0.17.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/phase-status\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The phase-status format and the phax release that wrote this file: https://docs.phax.run/schemas/phase-status/<X.Y.Z>.json",
  }),
);

const PhaseStateSchema = Schema.Union(
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
);

const EffortSchema = Schema.Union(
  Schema.Literal("none"),
  Schema.Literal("off"),
  Schema.Literal("low"),
  Schema.Literal("medium"),
  Schema.Literal("high"),
  Schema.Literal("xhigh"),
  Schema.Literal("max"),
  Schema.Literal("ultracode"),
  Schema.Literal("ultra"),
);

function isSafeBranchName(s: string): boolean {
  if (s.length === 0 || s[0] === "-") return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Reject ASCII control characters (0x00-0x1f), space (0x20), and DEL (0x7f).
    if (c <= 0x20 || c === 0x7f) return false;
  }
  return true;
}

const BranchNameSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(255),
  Schema.filter(isSafeBranchName, {
    message: () => "branch name must not start with '-' or contain whitespace/control characters",
    jsonSchema: { pattern: "^[^\\x00-\\x20\\x7f-][^\\x00-\\x20\\x7f]*$" },
  }),
  Schema.brand("BranchName"),
);

export const PhaseStatusV0_17_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  phaseId: Schema.NonEmptyString,
  phaseIndex: Schema.Number,
  state: PhaseStateSchema,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  branchName: BranchNameSchema,
  worktreePath: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  claudeSessionId: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
  commitHash: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
});

export type PhaseStatusV0_17_0 = Schema.Schema.Type<typeof PhaseStatusV0_17_0Schema>;

export const decodePhaseStatusV0_17_0 = Schema.decodeUnknownEither(PhaseStatusV0_17_0Schema);
