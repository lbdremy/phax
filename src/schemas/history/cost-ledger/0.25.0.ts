// The frozen 0.25.0 shape of `cost-ledger`: the cost-ledger.json phax 0.25.0
// through 0.25.x wrote, `$schema` first, with the phase roles phase, fix and
// handoff and no first-turn or closing-turn. Born with `$schema`; every key is
// required and any other key is refused. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it; the schemas package lists it as the
// format's 0.25.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.check(
  Schema.isPattern(
    /^https:\/\/docs\.phax\.run\/schemas\/cost-ledger\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The cost-ledger format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/cost-ledger/<X.Y.Z>.json",
  }),
);

const PhaseIdSchema = Schema.String.check(Schema.isPattern(/^phase-\d{2}$/)).pipe(
  Schema.annotate({ description: "The phase the invocation ran for." }),
);

const InstantSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
).pipe(Schema.annotate({ description: "An ISO-8601 UTC instant." }));

const TokensSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const UsdSchema = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
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
  window: Schema.Literals(["five-hour", "seven-day"]),
  utilization: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })).pipe(
    Schema.annotate({ description: "The window's utilization, in percent." }),
  ),
  resetsAt: InstantSchema.annotate({ description: "When the window resets." }),
  runCostUsd: UsdSchema.annotate({
    description:
      "The run's cumulative API-list cost when the stream reported the window: the earlier entries plus this invocation's priced messages so far.",
  }),
});

const entryFields = {
  completeness: Schema.Literals(["complete", "partial"]).annotate({
    description:
      "complete: read from the invocation's result event; partial: it ended without one, and its assistant messages were priced.",
  }),
  provider: Schema.Literal("claude-code"),
  sessionId: Schema.NonEmptyString,
  models: Schema.Record(Schema.NonEmptyString, ModelCostSchema).annotate({
    description: "The invocation's own tokens and API-list cost, by model id.",
  }),
  costUsd: UsdSchema.annotate({ description: "The sum of the models' costUsd." }),
  agentMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description:
      "The agent's duration in milliseconds: the result's duration_ms, or the wall-clock time phax measured for a partial entry.",
  }),
  endedAt: InstantSchema.annotate({ description: "When the invocation ended." }),
  rateLimitSamples: Schema.Array(RateLimitSampleSchema),
};

const PhaseEntrySchema = Schema.Struct({
  role: Schema.Literals(["phase", "fix", "handoff"]),
  phase: PhaseIdSchema,
  ...entryFields,
});

const ComplianceEntrySchema = Schema.Struct({
  role: Schema.Literal("compliance"),
  phase: Schema.Null,
  ...entryFields,
});

export const CostLedgerV0_25_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  entries: Schema.Array(Schema.Union([PhaseEntrySchema, ComplianceEntrySchema])),
});

export type CostLedgerV0_25_0 = Schema.Schema.Type<typeof CostLedgerV0_25_0Schema>;

export const decodeCostLedgerV0_25_0 = Schema.decodeUnknownResult(CostLedgerV0_25_0Schema, {
  onExcessProperty: "error",
  reportInput: true,
});
