import { Schema } from "effect";

const ProviderIdSchema = Schema.Union(
  Schema.Literal("claude-code"),
  Schema.Literal("codex-cli"),
  Schema.Literal("mistral-vibe"),
);

const AdapterSchema = Schema.Union(
  Schema.Literal("claude"),
  Schema.Literal("codex"),
  Schema.Literal("mistral"),
);

const BindingStatusSchema = Schema.Union(
  Schema.Literal("launching"),
  Schema.Literal("running"),
  Schema.Literal("awaiting_manual_review"),
  Schema.Literal("failed"),
  Schema.Literal("completed"),
  Schema.Literal("archived"),
);

export const PhaseAgentBindingSchema = Schema.Struct({
  version: Schema.Literal(1),
  shortName: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  phaseId: Schema.NonEmptyString.pipe(Schema.pattern(/^phase-\d{2}$/)),
  phaseIndex: Schema.Number,
  phaseName: Schema.NonEmptyString,
  provider: ProviderIdSchema,
  adapter: AdapterSchema,
  model: Schema.NonEmptyString,
  effort: Schema.NonEmptyString,
  sessionId: Schema.NullOr(Schema.NonEmptyString),
  sessionHandle: Schema.NullOr(Schema.NonEmptyString),
  worktreePath: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
  launchedAt: Schema.NonEmptyString,
  status: BindingStatusSchema,
});

export type PhaseAgentBinding = Schema.Schema.Type<typeof PhaseAgentBindingSchema>;

export const decodePhaseAgentBinding = Schema.decodeUnknownEither(PhaseAgentBindingSchema);
export const encodePhaseAgentBinding = Schema.encodeSync(PhaseAgentBindingSchema);
