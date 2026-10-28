import { scanCodexOutcomeEvents } from "../../schemas/codexOutput.js";
import type { EndedSession, SessionOutcome } from "./outcome.js";
import { failureFromText, failureWithoutVerdict } from "./signatures.js";

const PROVIDER = "codex-cli";
const LABEL = "codex";

const NO_ANSWER_MESSAGE = "codex ended its turn with no answer message: no answer was found";

/**
 * Reads an ended Codex session: `turn.failed` or `turn.completed` decides,
 * whatever the exit code; with neither, the process's end, the last `error`
 * event and stderr (see outcome.ts). Items other than the agent message
 * (command output, say) are never read.
 */
export function readCodexOutcome(ended: EndedSession): SessionOutcome {
  const events = scanCodexOutcomeEvents(ended.lines);
  const sessionId = events.threadId ?? null;
  const { turnEnd } = events;
  if (turnEnd?.kind === "failed") {
    const message = turnEnd.message ?? events.errorMessage ?? "codex reported turn.failed";
    return { kind: "failure", failure: failureFromText(PROVIDER, message, sessionId) };
  }
  if (turnEnd?.kind === "completed") {
    if (events.agentMessage !== undefined) {
      return { kind: "answer", provider: PROVIDER, text: events.agentMessage, sessionId };
    }
    return {
      kind: "failure",
      failure: {
        provider: PROVIDER,
        kind: "provider-error",
        message: NO_ANSWER_MESSAGE,
        sessionId,
        resetAt: null,
      },
    };
  }
  return {
    kind: "failure",
    failure: failureWithoutVerdict(PROVIDER, LABEL, ended, sessionId, events.errorMessage),
  };
}
