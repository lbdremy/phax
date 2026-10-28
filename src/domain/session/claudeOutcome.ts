import {
  scanClaudeOutcomeEvents,
  type ClaudeResultOutcomeEvent,
} from "../../schemas/claudeOutput.js";
import type { EndedSession, SessionFailure, SessionOutcome } from "./outcome.js";
import { failureFromText, failureWithoutVerdict } from "./signatures.js";

const PROVIDER = "claude-code";
const LABEL = "claude";

/** The failure an error result reads as, worded by the result's own text. */
function errorResultFailure(
  result: ClaudeResultOutcomeEvent,
  sessionId: string | null,
): SessionFailure {
  const maxTurns = result.subtype === "error_max_turns";
  const text = result.result;
  if (text !== undefined && text.trim().length > 0) {
    return failureFromText(PROVIDER, text, sessionId, maxTurns ? "max-turns" : "provider-error");
  }
  const firstError = result.errors?.[0];
  const message = firstError === undefined ? result.subtype : `${result.subtype}: ${firstError}`;
  return {
    provider: PROVIDER,
    kind: maxTurns ? "max-turns" : "provider-error",
    message,
    sessionId,
    resetAt: null,
  };
}

/**
 * Reads an ended Claude Code session: the last decodable `result` event
 * decides, whatever the exit code; with none, the process's end, the last
 * `api_retry` error and stderr (see outcome.ts).
 */
export function readClaudeOutcome(ended: EndedSession): SessionOutcome {
  const events = scanClaudeOutcomeEvents(ended.lines);
  const { result } = events;
  if (result !== undefined) {
    const sessionId = result.session_id ?? events.initSessionId ?? null;
    if (!result.is_error) {
      if (result.result !== undefined) {
        return { kind: "answer", provider: PROVIDER, text: result.result, sessionId };
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
    return { kind: "failure", failure: errorResultFailure(result, sessionId) };
  }
  return {
    kind: "failure",
    failure: failureWithoutVerdict(
      PROVIDER,
      LABEL,
      ended,
      events.initSessionId ?? null,
      events.apiRetryError,
    ),
  };
}
