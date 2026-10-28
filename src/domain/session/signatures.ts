import type { ProviderId } from "../routing/types.js";
import type { EndedSession, FailureKind, SessionFailure } from "./outcome.js";

/**
 * What a provider's own verdict text means: a network failure, a rate limit or
 * a usage limit. One table for every provider. Only ever applied to a verdict
 * (a result event's text, an error event, a failure export's message, stderr),
 * never to tool output or model text.
 */

/** Connection wordings, matched case-insensitively as substrings. */
export const NETWORK_SIGNATURES: readonly string[] = [
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "Can't reach the API server",
  "Connection error",
  "error sending request",
  "stream disconnected",
  "dns error",
  "failed to lookup address",
  "nodename nor servname",
  "Network is unreachable",
  "getaddrinfo",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "Request timed out",
  "fetch failed",
  "socket hang up",
  // The httpx wordings Vibe passes through.
  "Name or service not known",
  "Temporary failure in name resolution",
  "All connection attempts failed",
  "Connection refused",
  "Server disconnected without sending a response",
  "Timed out connecting to the model provider",
  "Timed out waiting for the model to send its response",
  "The model request timed out",
];

// Usage-limit signatures are checked first — they are the more specific case.
const USAGE_LIMIT_PATTERNS: readonly RegExp[] = [
  /usage limit/i,
  /monthly limit/i,
  /quota (?:exceeded|reached)/i,
];

const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
  /rate limit/i,
  /rate[-_ ]?limited/i,
  /too many requests/i,
  /\b429\b/,
  /rate_limit_error/i,
];

// Best-effort extraction of a human-readable reset time from a limit message.
const RESET_PATTERNS: readonly RegExp[] = [
  /reset(?:s|ting)?(?: at| on)?[:\s]+([^\n".]+)/i,
  /try again (?:at|after|in)[:\s]+([^\n".]+)/i,
  /available again[:\s]+([^\n".]+)/i,
  // Claude Code emits `usage limit reached|<epoch>` — capture the digit run
  /\|(\d{10,13})\b/,
];

const lowerCaseNetworkSignatures = NETWORK_SIGNATURES.map((signature) => signature.toLowerCase());

/** Typographic apostrophes read as the plain one the table is written with. */
function foldApostrophes(text: string): string {
  return text.replace(/[‘’]/g, "'");
}

/** The class of a provider's verdict text, or null when it matches no signature. */
export function classifyVerdictText(text: string): "network" | "rate-limit" | "usage-limit" | null {
  if (USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) return "usage-limit";
  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) return "rate-limit";
  const folded = foldApostrophes(text).toLowerCase();
  if (lowerCaseNetworkSignatures.some((signature) => folded.includes(signature))) return "network";
  return null;
}

/**
 * Normalize a raw reset-time candidate to an ISO-8601 instant, or null when
 * the candidate is not a recognizable date or epoch.
 */
export function normalizeResetAt(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Bare Unix epoch seconds (exactly 10 digits)
  if (/^\d{10}$/.test(s)) return new Date(parseInt(s, 10) * 1000).toISOString();

  // Bare Unix epoch milliseconds (exactly 13 digits)
  if (/^\d{13}$/.test(s)) return new Date(parseInt(s, 10)).toISOString();

  // Any string Date.parse recognises (ISO, RFC, locale dates from providers)
  const ts = Date.parse(s);
  if (isFinite(ts)) return new Date(ts).toISOString();

  return null;
}

/** The reset time a limit message names, as an ISO instant, or null. */
export function extractResetAt(text: string): string | null {
  for (const pattern of RESET_PATTERNS) {
    const captured = text.match(pattern)?.[1]?.trim();
    if (captured) {
      const normalized = normalizeResetAt(captured);
      if (normalized !== null) return normalized;
    }
  }
  return null;
}

/** The first non-empty lines of stderr, at most three, joined by a space. */
export function stderrMessage(stderr: string): string {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3)
    .join(" ");
}

/**
 * A failure worded by a provider's own text. The kind is read from the text:
 * a limit or network signature, else `otherwise`. A limit carries its reset
 * time when the text names one.
 */
export function failureFromText(
  provider: ProviderId,
  text: string,
  sessionId: string | null,
  otherwise: FailureKind = "provider-error",
): SessionFailure {
  const kind = classifyVerdictText(text) ?? otherwise;
  const resetAt = kind === "rate-limit" || kind === "usage-limit" ? extractResetAt(text) : null;
  return { provider, kind, message: text, sessionId, resetAt };
}

/**
 * A session with no verdict, read from how it ended: a signal or timeout is
 * `killed`; otherwise the last error event's text, then stderr's first lines;
 * otherwise `unknown`.
 */
export function failureWithoutVerdict(
  provider: ProviderId,
  label: string,
  ended: EndedSession,
  sessionId: string | null,
  errorEventText: string | undefined,
): SessionFailure {
  const { end } = ended;
  if (end.kind === "signalled" || end.kind === "timed-out") {
    const message =
      end.kind === "signalled"
        ? `${label} was terminated by ${end.signal}`
        : `${label} timed out and was stopped`;
    return { provider, kind: "killed", message, sessionId, resetAt: null };
  }
  if (errorEventText !== undefined && errorEventText.trim().length > 0) {
    return failureFromText(provider, errorEventText, sessionId, "provider-error");
  }
  const fromStderr = stderrMessage(ended.stderr);
  if (fromStderr.length > 0)
    return failureFromText(provider, fromStderr, sessionId, "provider-error");
  const message = `${label} exited with code ${end.code} and reported no result`;
  return { provider, kind: "unknown", message, sessionId, resetAt: null };
}
