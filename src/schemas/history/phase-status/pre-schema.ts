// The frozen pre-schema shape of `phase-status`: exactly what phax wrote
// before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
import { Schema } from "effect";

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

export const PhaseStatusPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(1),
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

export type PhaseStatusPreSchema = Schema.Schema.Type<typeof PhaseStatusPreSchemaSchema>;

export const decodePhaseStatusPreSchema = Schema.decodeUnknownEither(PhaseStatusPreSchemaSchema);
