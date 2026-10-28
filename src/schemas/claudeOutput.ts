import { Either, Schema } from "effect";

/**
 * What the session outcome reader takes from a Claude Code stream: the last
 * decodable `result` event, the `system`/`init` event's session id and the
 * last `system`/`api_retry` event's error. Provider output, so unknown keys
 * are dropped and a line that is not JSON, or no event read here, is skipped.
 */
const ClaudeResultOutcomeEventSchema = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.String,
  is_error: Schema.Boolean,
  result: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  errors: Schema.optional(Schema.Array(Schema.String)),
});

const ClaudeInitEventSchema = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  session_id: Schema.NonEmptyString,
});

/** The retry's error is a string (`"Connection error."`) or an object with a message. */
const ClaudeApiRetryEventSchema = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("api_retry"),
  error: Schema.Union(Schema.String, Schema.Struct({ message: Schema.String })),
});

export type ClaudeResultOutcomeEvent = Schema.Schema.Type<typeof ClaudeResultOutcomeEventSchema>;

export const decodeClaudeResultOutcomeEvent = Schema.decodeUnknownEither(
  ClaudeResultOutcomeEventSchema,
);
export const decodeClaudeInitEvent = Schema.decodeUnknownEither(ClaudeInitEventSchema);
export const decodeClaudeApiRetryEvent = Schema.decodeUnknownEither(ClaudeApiRetryEventSchema);

/** The events of one Claude Code stream that decide how its session ended. */
interface ClaudeOutcomeEvents {
  /** The last `result` event that decodes. */
  readonly result: ClaudeResultOutcomeEvent | undefined;
  /** The first `system`/`init` event's session id. */
  readonly initSessionId: string | undefined;
  /** The last `system`/`api_retry` event's error text. */
  readonly apiRetryError: string | undefined;
}

export function scanClaudeOutcomeEvents(lines: readonly string[]): ClaudeOutcomeEvents {
  let result: ClaudeResultOutcomeEvent | undefined;
  let initSessionId: string | undefined;
  let apiRetryError: string | undefined;
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    const decodedResult = decodeClaudeResultOutcomeEvent(parsed);
    if (Either.isRight(decodedResult)) {
      result = decodedResult.right;
      continue;
    }
    const decodedInit = decodeClaudeInitEvent(parsed);
    if (Either.isRight(decodedInit)) {
      initSessionId ??= decodedInit.right.session_id;
      continue;
    }
    const decodedRetry = decodeClaudeApiRetryEvent(parsed);
    if (Either.isRight(decodedRetry)) {
      const error = decodedRetry.right.error;
      apiRetryError = typeof error === "string" ? error : error.message;
    }
  }
  return { result, initSessionId, apiRetryError };
}
