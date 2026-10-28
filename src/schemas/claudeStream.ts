// The cost facts of one Claude Code stream-json output: the init event's
// version, session and API key source, the assistant messages' usage, the
// rate-limit events' window readings and how many failed to decode, the last
// result's per-model usage and every result's duration. Provider output, so unknown keys are ignored; a line that is not
// JSON, or no event this module reads, is skipped, as `scanClaudeOutcomeEvents`
// skips one. A missing token count is 0. The cost ledger's domain receives only
// these facts, never raw lines.
import { Either, Schema } from "effect";

const Tokens = Schema.optionalWith(Schema.NonNegativeInt, { default: () => 0 });

const InitEventSchema = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  session_id: Schema.NonEmptyString,
  claude_code_version: Schema.optional(Schema.String),
  apiKeySource: Schema.optional(Schema.NullOr(Schema.String)),
});

const AssistantEventSchema = Schema.Struct({
  type: Schema.Literal("assistant"),
  message: Schema.Struct({
    id: Schema.NonEmptyString,
    model: Schema.NonEmptyString,
    usage: Schema.Struct({
      input_tokens: Tokens,
      output_tokens: Tokens,
      cache_read_input_tokens: Tokens,
      cache_creation_input_tokens: Tokens,
      cache_creation: Schema.optional(Schema.Struct({ ephemeral_1h_input_tokens: Tokens })),
    }),
  }),
});

// Epoch seconds a Date can hold.
const WindowSchema = Schema.Struct({
  utilization: Schema.Finite,
  resetsAt: Schema.Int.pipe(Schema.between(0, 8_640_000_000_000)),
});

const RateLimitEventSchema = Schema.Struct({
  type: Schema.Literal("rate_limit_event"),
  rate_limit_info: Schema.Struct({
    unifiedWindows: Schema.optional(
      Schema.Struct({
        five_hour: Schema.optional(WindowSchema),
        seven_day: Schema.optional(WindowSchema),
      }),
    ),
  }),
});

const ResultEventSchema = Schema.Struct({
  type: Schema.Literal("result"),
  session_id: Schema.optional(Schema.String),
  duration_ms: Schema.optionalWith(Schema.NonNegative, { default: () => 0 }),
  modelUsage: Schema.Record({
    key: Schema.NonEmptyString,
    value: Schema.Struct({
      inputTokens: Tokens,
      outputTokens: Tokens,
      cacheReadInputTokens: Tokens,
      cacheCreationInputTokens: Tokens,
      costUSD: Schema.optionalWith(Schema.NonNegative, { default: () => 0 }),
    }),
  }),
});

const decodeInitEvent = Schema.decodeUnknownEither(InitEventSchema);
const decodeAssistantEvent = Schema.decodeUnknownEither(AssistantEventSchema);
const decodeRateLimitEvent = Schema.decodeUnknownEither(RateLimitEventSchema);
const decodeResultEvent = Schema.decodeUnknownEither(ResultEventSchema);

/** One assistant message's usage; `cacheWrite1hTokens` is part of `cacheWriteTokens`. */
export interface StreamMessageUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheWrite1hTokens: number;
}

/** One model's usage as the result event reports it. */
export interface StreamModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
}

/** One window reading of a rate-limit event: `fraction` is the stream's 0..1 utilization. */
export interface StreamWindowReading {
  readonly window: "five-hour" | "seven-day";
  readonly fraction: number;
  readonly resetsAtEpochSeconds: number;
}

export type ClaudeStreamEvent =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly model: string;
      readonly usage: StreamMessageUsage;
    }
  | { readonly kind: "rate-limit"; readonly readings: ReadonlyArray<StreamWindowReading> };

export interface ClaudeStreamFacts {
  /** The init event's `claude_code_version` as an X.Y.Z triple, or null. */
  readonly claudeCodeVersion: readonly [number, number, number] | null;
  /** The init event's session id, else the result's, else null. */
  readonly sessionId: string | null;
  /** The init event's `apiKeySource` (`none` under a subscription login), or null when absent. */
  readonly apiKeySource: string | null;
  /** The `rate_limit_event` lines that fail to decode; one without `unifiedWindows` decodes. */
  readonly undecodedRateLimitEvents: number;
  /** Assistant messages and rate-limit readings, in stream order. */
  readonly events: ReadonlyArray<ClaudeStreamEvent>;
  /**
   * The result events that carry `modelUsage`, or null when there is none.
   * One process reports a result per stretch of agent work (a background task
   * that finishes wakes the agent again), each repeating the process's whole
   * `modelUsage` but timing only its own stretch: `modelUsage` is the last
   * result's, `durationMs` the sum of their `duration_ms`.
   */
  readonly result: {
    readonly durationMs: number;
    readonly modelUsage: Readonly<Record<string, StreamModelUsage>>;
  } | null;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(value: string | undefined): readonly [number, number, number] | null {
  const match = value === undefined ? null : VERSION.exec(value);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseLine(line: string): unknown {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

/** Reads the cost facts of a Claude stream's lines. Never throws. */
export function parseClaudeStream(lines: readonly string[]): ClaudeStreamFacts {
  let init: {
    sessionId: string;
    version: readonly [number, number, number] | null;
    apiKeySource: string | null;
  } | null = null;
  let result: {
    sessionId: string | undefined;
    facts: NonNullable<ClaudeStreamFacts["result"]>;
  } | null = null;
  let resultDurationMs = 0;
  let undecodedRateLimitEvents = 0;
  const events: ClaudeStreamEvent[] = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    if (typeof parsed !== "object" || parsed === null) continue;
    const type = (parsed as { readonly type?: unknown }).type;

    if (type === "system") {
      const decoded = decodeInitEvent(parsed);
      if (init === null && Either.isRight(decoded)) {
        init = {
          sessionId: decoded.right.session_id,
          version: parseVersion(decoded.right.claude_code_version),
          apiKeySource: decoded.right.apiKeySource ?? null,
        };
      }
    } else if (type === "assistant") {
      const decoded = decodeAssistantEvent(parsed);
      if (Either.isRight(decoded)) {
        const { id, model, usage } = decoded.right.message;
        events.push({
          kind: "message",
          id,
          model,
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens,
            cacheWriteTokens: usage.cache_creation_input_tokens,
            cacheWrite1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
          },
        });
      }
    } else if (type === "rate_limit_event") {
      const decoded = decodeRateLimitEvent(parsed);
      if (Either.isLeft(decoded)) {
        undecodedRateLimitEvents += 1;
        continue;
      }
      const windows = decoded.right.rate_limit_info.unifiedWindows;
      if (windows === undefined) continue;
      const readings: StreamWindowReading[] = [];
      if (windows.five_hour !== undefined) {
        readings.push({
          window: "five-hour",
          fraction: windows.five_hour.utilization,
          resetsAtEpochSeconds: windows.five_hour.resetsAt,
        });
      }
      if (windows.seven_day !== undefined) {
        readings.push({
          window: "seven-day",
          fraction: windows.seven_day.utilization,
          resetsAtEpochSeconds: windows.seven_day.resetsAt,
        });
      }
      if (readings.length > 0) events.push({ kind: "rate-limit", readings });
    } else if (type === "result") {
      const decoded = decodeResultEvent(parsed);
      if (Either.isRight(decoded)) {
        const modelUsage: Record<string, StreamModelUsage> = {};
        for (const [model, usage] of Object.entries(decoded.right.modelUsage)) {
          modelUsage[model] = {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadInputTokens,
            cacheWriteTokens: usage.cacheCreationInputTokens,
            costUsd: usage.costUSD,
          };
        }
        resultDurationMs += decoded.right.duration_ms;
        result = {
          sessionId: decoded.right.session_id,
          facts: { durationMs: resultDurationMs, modelUsage },
        };
      }
    }
  }

  const resultSessionId =
    result?.sessionId !== undefined && result.sessionId !== "" ? result.sessionId : null;
  return {
    claudeCodeVersion: init?.version ?? null,
    sessionId: init?.sessionId ?? resultSessionId,
    apiKeySource: init?.apiKeySource ?? null,
    undecodedRateLimitEvents,
    events,
    result: result?.facts ?? null,
  };
}
