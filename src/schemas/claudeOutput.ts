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
];

function extractResetAt(haystack: string): string | undefined {
  for (const pattern of RESET_PATTERNS) {
    const match = haystack.match(pattern);
    const captured = match?.[1]?.trim();
    if (captured) return captured;
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
