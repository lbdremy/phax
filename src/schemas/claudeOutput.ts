import { Either, Schema } from "effect";

/**
 * What the session outcome reader takes from a Claude Code stream: the last
 * decodable `result` event, the `system`/`init` event's session id, the last
 * `system`/`api_retry` event when nothing but retries follows it, the last
 * synthetic API-error assistant message's error category and the reset time of
 * the last rejected `rate_limit_event`. Provider output, so unknown keys are
 * dropped and a line that is not JSON, or no event read here, is skipped.
 *
 * Claude Code 2.1.312 ends a session that hit an API error with a synthetic
 * assistant message (`is_api_error_message: true`, `error` a category such as
 * `rate_limit` or `billing_error`) and a result `subtype: "success"`,
 * `is_error: true`, whose `result` is the formatted error text,
 * `terminal_reason: "api_error"` and `api_error_status` the HTTP status (null
 * when the request got no HTTP response, a connection failure).
 */
const ClaudeResultOutcomeEventSchema = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.String,
  is_error: Schema.Boolean,
  result: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  errors: Schema.optional(Schema.Array(Schema.String)),
  terminal_reason: Schema.optional(Schema.String),
  api_error_status: Schema.optional(Schema.NullOr(Schema.Number)),
});

const ClaudeInitEventSchema = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  session_id: Schema.NonEmptyString,
});

/**
 * A retryable API failure Claude Code is about to retry. `error` is a category
 * (`unknown`, `rate_limit`, `overloaded`, `server_error`,
 * `authentication_failed`, `billing_error`, …), not a message; `error_status`
 * is the HTTP status, null for a connection failure with no HTTP response.
 * Decoded as a string so a category added later still reads.
 */
const ClaudeApiRetryEventSchema = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("api_retry"),
  attempt: Schema.optional(Schema.Number),
  max_retries: Schema.optional(Schema.Number),
  error_status: Schema.NullOr(Schema.Number),
  error: Schema.String,
});

/** The synthetic assistant message that wraps an API error. */
const ClaudeApiErrorMessageSchema = Schema.Struct({
  type: Schema.Literal("assistant"),
  is_api_error_message: Schema.Literal(true),
  error: Schema.String,
});

/** A rate-limit status change; `resetsAt` is in epoch seconds. */
const ClaudeRateLimitEventSchema = Schema.Struct({
  type: Schema.Literal("rate_limit_event"),
  rate_limit_info: Schema.Struct({
    status: Schema.String,
    resetsAt: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
});

export type ClaudeResultOutcomeEvent = Schema.Schema.Type<typeof ClaudeResultOutcomeEventSchema>;
export type ClaudeApiRetryEvent = Schema.Schema.Type<typeof ClaudeApiRetryEventSchema>;

export const decodeClaudeResultOutcomeEvent = Schema.decodeUnknownEither(
  ClaudeResultOutcomeEventSchema,
);
export const decodeClaudeInitEvent = Schema.decodeUnknownEither(ClaudeInitEventSchema);
export const decodeClaudeApiRetryEvent = Schema.decodeUnknownEither(ClaudeApiRetryEventSchema);
const decodeClaudeApiErrorMessage = Schema.decodeUnknownEither(ClaudeApiErrorMessageSchema);
const decodeClaudeRateLimitEvent = Schema.decodeUnknownEither(ClaudeRateLimitEventSchema);

/** The events of one Claude Code stream that decide how its session ended. */
interface ClaudeOutcomeEvents {
  /** The last `result` event that decodes. */
  readonly result: ClaudeResultOutcomeEvent | undefined;
  /** The first `system`/`init` event's session id. */
  readonly initSessionId: string | undefined;
  /**
   * The last `system`/`api_retry` event, when no other event follows it: the
   * retry the session was still in when it ended. A retry the session got
   * past (any later event) is not kept.
   */
  readonly trailingApiRetry: ClaudeApiRetryEvent | undefined;
  /** The last synthetic API-error assistant message's error category. */
  readonly apiErrorCategory: string | undefined;
  /** The last rejected `rate_limit_event`'s reset time, in epoch seconds. */
  readonly rejectedResetsAt: number | undefined;
}

export function scanClaudeOutcomeEvents(lines: readonly string[]): ClaudeOutcomeEvents {
  let result: ClaudeResultOutcomeEvent | undefined;
  let initSessionId: string | undefined;
  let trailingApiRetry: ClaudeApiRetryEvent | undefined;
  let apiErrorCategory: string | undefined;
  let rejectedResetsAt: number | undefined;
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const decodedRetry = decodeClaudeApiRetryEvent(parsed);
    if (Either.isRight(decodedRetry)) {
      trailingApiRetry = decodedRetry.right;
      continue;
    }
    // Any other event means the session went on past the retry.
    trailingApiRetry = undefined;
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
    const decodedApiError = decodeClaudeApiErrorMessage(parsed);
    if (Either.isRight(decodedApiError)) {
      apiErrorCategory = decodedApiError.right.error;
      continue;
    }
    const decodedRateLimit = decodeClaudeRateLimitEvent(parsed);
    if (Either.isRight(decodedRateLimit)) {
      const info = decodedRateLimit.right.rate_limit_info;
      if (info.status === "rejected" && typeof info.resetsAt === "number") {
        rejectedResetsAt = info.resetsAt;
      }
    }
  }
  return { result, initSessionId, trailingApiRetry, apiErrorCategory, rejectedResetsAt };
}
