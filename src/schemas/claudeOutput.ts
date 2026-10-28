import { Either, Schema } from "effect";

export const ClaudeResultEventSchema = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.String,
  result: Schema.String,
  session_id: Schema.String,
  is_error: Schema.Boolean,
});

export type ClaudeResultEvent = Schema.Schema.Type<typeof ClaudeResultEventSchema>;

export const decodeClaudeResultEvent = Schema.decodeUnknownEither(ClaudeResultEventSchema);

export function findResultEvent(
  lines: readonly string[],
): { sessionId: string; finalText: string } | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      const decoded = decodeClaudeResultEvent(parsed);
      if (Either.isRight(decoded)) {
        return { sessionId: decoded.right.session_id, finalText: decoded.right.result };
      }
    } catch {
      // not a valid JSON line, skip
    }
  }
  return undefined;
}

/** Returns true when the output contains a `result` event flagged `is_error`. */
export function hasErroredResultEvent(lines: readonly string[]): boolean {
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const decoded = decodeClaudeResultEvent(JSON.parse(line) as unknown);
      if (Either.isRight(decoded) && decoded.right.is_error) return true;
    } catch {
      // not a valid JSON line, skip
    }
  }
  return false;
}

export type RateLimitKind = "rate_limit" | "usage_limit";

export interface RateLimitClassification {
  readonly kind: RateLimitKind;
  readonly rawMessage: string;
  readonly resetAt?: string | undefined;
}

// Usage-limit signatures are checked first — they are the more specific case.
const USAGE_LIMIT_PATTERNS: readonly RegExp[] = [
  /usage limit/i,
  /usage limit reached/i,
  /monthly limit/i,
  /quota (?:exceeded|reached)/i,
];

const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
  /rate limit/i,
  /rate[-_ ]?limited/i,
  /too many requests/i,
  /\b429\b/,
];

// Best-effort extraction of a human-readable reset time from a limit message.
const RESET_PATTERNS: readonly RegExp[] = [
  /reset(?:s|ting)?(?: at| on)?[:\s]+([^\n".]+)/i,
  /try again (?:at|after|in)[:\s]+([^\n".]+)/i,
  /available again[:\s]+([^\n".]+)/i,
  // Claude Code emits `usage limit reached|<epoch>` — capture the digit run
  /\|(\d{10,13})\b/,
];

/**
 * Normalize a raw reset-time candidate to an ISO-8601 instant, or return
 * `undefined` if the candidate is not a recognizable date/epoch.
 */
export function normalizeResetAt(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;

  // Bare Unix epoch seconds (exactly 10 digits)
  if (/^\d{10}$/.test(s)) {
    return new Date(parseInt(s, 10) * 1000).toISOString();
  }

  // Bare Unix epoch milliseconds (exactly 13 digits)
  if (/^\d{13}$/.test(s)) {
    return new Date(parseInt(s, 10)).toISOString();
  }

  // Any string Date.parse recognises (ISO, RFC, locale dates from providers)
  const ts = Date.parse(s);
  if (isFinite(ts)) return new Date(ts).toISOString();

  return undefined;
}

function extractResetAt(haystack: string): string | undefined {
  for (const pattern of RESET_PATTERNS) {
    const match = haystack.match(pattern);
    const captured = match?.[1]?.trim();
    if (captured) {
      const normalized = normalizeResetAt(captured);
      if (normalized !== undefined) return normalized;
    }
  }
  return undefined;
}

/**
 * Inspect Claude CLI failure output for rate-limit / usage-limit signatures.
 *
 * Scans `stderr` plus the raw stdout JSONL lines. Returns `undefined` whenever
 * the signal is ambiguous — callers must default to "not a rate limit" so a
 * genuine invocation error is never silently reclassified.
 */
export function classifyRateLimit(
  stderr: string,
  lines: readonly string[],
): RateLimitClassification | undefined {
  const haystack = [stderr, ...lines].join("\n");
  if (haystack.trim().length === 0) return undefined;

  for (const pattern of USAGE_LIMIT_PATTERNS) {
    if (pattern.test(haystack)) {
      return { kind: "usage_limit", rawMessage: haystack, resetAt: extractResetAt(haystack) };
    }
  }

  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(haystack)) {
      return { kind: "rate_limit", rawMessage: haystack, resetAt: extractResetAt(haystack) };
    }
  }

  return undefined;
}

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
