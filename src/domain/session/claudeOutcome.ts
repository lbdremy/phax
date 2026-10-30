import {
  scanClaudeOutcomeEvents,
  type ClaudeApiRetryEvent,
  type ClaudeResultOutcomeEvent,
} from "../../schemas/claudeOutput.js";
import type { EndedSession, FailureKind, SessionFailure, SessionOutcome } from "./outcome.js";
import { classifyVerdictText, extractResetAt, failureWithoutVerdict } from "./signatures.js";

const PROVIDER = "claude-code";
const LABEL = "claude";

/** The result subtype Claude Code ends with when the model could not meet `--json-schema`. */
const STRUCTURED_RETRIES_SUBTYPE = "error_max_structured_output_retries";

/**
 * Whether a failure is Claude Code giving up on the handed schema after its
 * own retries. Recognized by the result subtype alone, never by text.
 */
export function isStructuredRetriesExhausted(failure: SessionFailure): boolean {
  return failure.provider === PROVIDER && failure.providerSubtype === STRUCTURED_RETRIES_SUBTYPE;
}

/**
 * The kind an error result's structured fields give when its text matches no
 * signature: an HTTP 429, or a synthetic API-error message categorized
 * `rate_limit`, is a rate limit; `billing_error` is a usage limit; an API error
 * that got no HTTP response (`terminal_reason: "api_error"`,
 * `api_error_status: null`) is a network failure.
 */
function structuredKind(
  result: ClaudeResultOutcomeEvent,
  apiErrorCategory: string | undefined,
): FailureKind | null {
  if (apiErrorCategory === "billing_error") return "usage-limit";
  if (result.api_error_status === 429 || apiErrorCategory === "rate_limit") return "rate-limit";
  if (result.terminal_reason === "api_error" && result.api_error_status === null) return "network";
  return null;
}

/** A limit's reset time: the rejected rate-limit event's, else the one its text names. */
function resetAtOf(kind: FailureKind, text: string, rejectedResetsAt: number | undefined) {
  if (kind !== "rate-limit" && kind !== "usage-limit") return null;
  if (rejectedResetsAt !== undefined) return new Date(rejectedResetsAt * 1000).toISOString();
  return extractResetAt(text);
}

/** The failure an error result reads as, worded by the result's own text. */
function errorResultFailure(
  result: ClaudeResultOutcomeEvent,
  sessionId: string | null,
  apiErrorCategory: string | undefined,
  rejectedResetsAt: number | undefined,
): SessionFailure {
  const otherwise: FailureKind =
    result.subtype === "error_max_turns" ? "max-turns" : "provider-error";
  const text = result.result;
  const firstError = result.errors?.[0];
  const hasText = text !== undefined && text.trim().length > 0;
  if (result.subtype === STRUCTURED_RETRIES_SUBTYPE) {
    const detail = hasText ? text : firstError;
    return {
      provider: PROVIDER,
      kind: "provider-error",
      message: detail === undefined ? result.subtype : `${result.subtype}: ${detail}`,
      sessionId,
      resetAt: null,
      providerSubtype: result.subtype,
    };
  }
  const message = hasText
    ? text
    : firstError === undefined
      ? result.subtype
      : `${result.subtype}: ${firstError}`;
  const kind =
    (text !== undefined ? classifyVerdictText(text) : null) ??
    structuredKind(result, apiErrorCategory) ??
    otherwise;
  return {
    provider: PROVIDER,
    kind,
    message,
    sessionId,
    resetAt: resetAtOf(kind, message, rejectedResetsAt),
  };
}

/**
 * The failure a retry the session was still in when it ended reads as: a
 * `rate_limit` retry is a rate limit, a retry with no HTTP status a network
 * failure. Any other retry says nothing stderr cannot say better.
 */
function trailingRetryFailure(
  retry: ClaudeApiRetryEvent,
  sessionId: string | null,
  rejectedResetsAt: number | undefined,
): SessionFailure | null {
  const attempt =
    retry.attempt === undefined
      ? ""
      : retry.max_retries === undefined
        ? ` (attempt ${retry.attempt})`
        : ` (attempt ${retry.attempt} of ${retry.max_retries})`;
  if (retry.error === "rate_limit") {
    const status = retry.error_status === null ? "" : ` ${retry.error_status}`;
    return {
      provider: PROVIDER,
      kind: "rate-limit",
      message: `API Error:${status} rate limited; the session ended while retrying${attempt}`,
      sessionId,
      resetAt: resetAtOf("rate-limit", "", rejectedResetsAt),
    };
  }
  if (retry.error_status === null) {
    return {
      provider: PROVIDER,
      kind: "network",
      message: `API Error: no response from the API (connection failed); the session ended while retrying${attempt}`,
      sessionId,
      resetAt: null,
    };
  }
  return null;
}

/**
 * Reads an ended Claude Code session: the last decodable `result` event
 * decides, whatever the exit code. A success answers with its
 * `structured_output` when it carries one (its text may be empty), else with
 * its `result` when that is non-blank: a prose result with no structured
 * output is what Claude Code prints when the model could not meet the schema,
 * and it reads as text for phax's decoder to refuse; with none, the process's end, the
 * `api_retry` the session was still in when it ended, and stderr (see
 * outcome.ts).
 */
export function readClaudeOutcome(ended: EndedSession): SessionOutcome {
  const events = scanClaudeOutcomeEvents(ended.lines);
  const { result } = events;
  if (result !== undefined) {
    const sessionId = result.session_id ?? events.initSessionId ?? null;
    if (!result.is_error && result.subtype !== STRUCTURED_RETRIES_SUBTYPE) {
      if (result.structured_output !== undefined) {
        return {
          kind: "answer",
          provider: PROVIDER,
          text: result.result ?? "",
          structured: { value: result.structured_output },
          sessionId,
        };
      }
      if (result.result !== undefined && result.result.trim().length > 0) {
        return {
          kind: "answer",
          provider: PROVIDER,
          text: result.result,
          structured: null,
          sessionId,
        };
      }
      return {
        kind: "failure",
        failure: {
          provider: PROVIDER,
          kind: "provider-error",
          message: `${result.subtype}: the result carried no result text`,
          sessionId,
          resetAt: null,
        },
      };
    }
    return {
      kind: "failure",
      failure: errorResultFailure(
        result,
        sessionId,
        events.apiErrorCategory,
        events.rejectedResetsAt,
      ),
    };
  }
  const sessionId = events.initSessionId ?? null;
  const ending = ended.end.kind;
  if (ending === "exited" && events.trailingApiRetry !== undefined) {
    const fromRetry = trailingRetryFailure(
      events.trailingApiRetry,
      sessionId,
      events.rejectedResetsAt,
    );
    if (fromRetry !== null) return { kind: "failure", failure: fromRetry };
  }
  return {
    kind: "failure",
    failure: failureWithoutVerdict(PROVIDER, LABEL, ended, sessionId, undefined),
  };
}
