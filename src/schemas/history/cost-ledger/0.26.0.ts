// The frozen 0.26.0 shape of `cost-ledger`: the cost-ledger.json phax 0.26.0
// through 0.28.x wrote, `$schema` first, with the phase roles phase, fix,
// handoff, first-turn and closing-turn and the compliance role, and no
// code-review role. Born with `$schema`; every key is required and any other
// key is refused. Never edit this module: packages/schemas/history.lock.json
// pins its bytes. In phax, only src/schemas/persisted.ts may import it; the
// schemas package lists it as the format's 0.26.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/cost-ledger\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The cost-ledger format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/cost-ledger/<X.Y.Z>.json",
  }),
);

const PhaseIdSchema = Schema.String.pipe(
  Schema.pattern(/^phase-\d{2}$/),
  Schema.annotations({ description: "The phase the invocation ran for." }),
);

const InstantSchema = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
  Schema.annotations({ description: "An ISO-8601 UTC instant." }),
);

const TokensSchema = Schema.NonNegativeInt;

const UsdSchema = Schema.NonNegative.annotations({
  description: "USD at Anthropic's API list prices, rounded to 6 decimals.",
});

const ModelCostSchema = Schema.Struct({
  inputTokens: TokensSchema,
  outputTokens: TokensSchema,
  cacheReadTokens: TokensSchema,
  cacheWriteTokens: TokensSchema,
  costUsd: UsdSchema,
});

const RateLimitSampleSchema = Schema.Struct({
  window: Schema.Literal("five-hour", "seven-day"),
  utilization: Schema.Number.pipe(
    Schema.between(0, 100),
    Schema.annotations({ description: "The window's utilization, in percent." }),
  ),
  resetsAt: InstantSchema.annotations({ description: "When the window resets." }),
  runCostUsd: UsdSchema.annotations({
    description:
      "The run's cumulative API-list cost when the stream reported the window: the earlier entries plus this invocation's priced messages so far.",
  }),
});

const entryFields = {
  completeness: Schema.Literal("complete", "partial").annotations({
    description:
      "complete: read from the invocation's result event; partial: it ended without one, and its assistant messages were priced.",
  }),
  provider: Schema.Literal("claude-code"),
  sessionId: Schema.NonEmptyString,
  models: Schema.Record({ key: Schema.NonEmptyString, value: ModelCostSchema }).annotations({
    description: "The invocation's own tokens and API-list cost, by model id.",
  }),
  costUsd: UsdSchema.annotations({ description: "The sum of the models' costUsd." }),
  agentMs: Schema.NonNegativeInt.annotations({
    description:
      "The agent's duration in milliseconds: the result's duration_ms, or the wall-clock time phax measured for a partial entry.",
  }),
  endedAt: InstantSchema.annotations({ description: "When the invocation ended." }),
  rateLimitSamples: Schema.Array(RateLimitSampleSchema),
};

const PhaseEntrySchema = Schema.Struct({
  role: Schema.Literal("phase", "fix", "handoff", "first-turn", "closing-turn"),
  phase: PhaseIdSchema,
  ...entryFields,
});

const ComplianceEntrySchema = Schema.Struct({
  role: Schema.Literal("compliance"),
  phase: Schema.Null,
  ...entryFields,
});

export const CostLedgerV0_26_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  entries: Schema.Array(Schema.Union(PhaseEntrySchema, ComplianceEntrySchema)),
});

export type CostLedgerV0_26_0 = Schema.Schema.Type<typeof CostLedgerV0_26_0Schema>;

export const decodeCostLedgerV0_26_0 = Schema.decodeUnknownEither(CostLedgerV0_26_0Schema, {
  onExcessProperty: "error",
});
