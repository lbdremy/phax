// The `cost-ledger` document: `<run folder>/cost-ledger.json`, one entry per
// Claude invocation of a run (a phase turn, a fix attempt, a handoff
// generation, the compliance review or the code review), appended when the invocation ends.
// Each entry holds that invocation's own API-list cost and tokens per model,
// its agent duration, its end time and the subscription-window samples its
// stream reported. Born with `$schema`; phax reads it through the bridge
// (`readCostLedgerFile`) and writes it with `withSchemaUrl`.
import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

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

const RunEntrySchema = Schema.Struct({
  role: Schema.Literal("compliance", "code-review"),
  phase: Schema.Null,
  ...entryFields,
});

const CostLedgerEntrySchema = Schema.Union(PhaseEntrySchema, RunEntrySchema);

/**
 * A `cost-ledger` document: `$schema`, then the run's entries in the order
 * the invocations ended. Every key is required; any other key is refused, at
 * any level.
 */
export const CostLedgerFileSchema = Schema.Struct({
  $schema: schemaUrlField("cost-ledger"),
  entries: Schema.Array(CostLedgerEntrySchema),
});

export type CostLedgerFile = Schema.Schema.Type<typeof CostLedgerFileSchema>;

/** A cost ledger, without `$schema`. */
export type CostLedger = Omit<CostLedgerFile, "$schema">;

/** One invocation's entry. */
export type CostLedgerEntry = Schema.Schema.Type<typeof CostLedgerEntrySchema>;

/**
 * What the invocation was: a phase turn, a fix attempt, a handoff, an
 * interactive phase's first or closing turn, or the compliance or code review.
 */
export type CostLedgerRole = CostLedgerEntry["role"];

/** One reading of a subscription window. */
export type RateLimitSample = Schema.Schema.Type<typeof RateLimitSampleSchema>;

export const decodeCostLedgerFile = Schema.decodeUnknownEither(CostLedgerFileSchema, {
  onExcessProperty: "error",
});
