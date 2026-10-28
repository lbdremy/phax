import { Either } from "effect";
import { decodeVibeOutcomeText, type VibeOutcomeExport } from "../../schemas/vibeExport.js";
import { findVibeResultEvent, findVibeStreamHead } from "../../schemas/vibeOutput.js";
import type { EndedSession, SessionFailure, SessionOutcome, VibeExportRead } from "./outcome.js";
import { failureFromText, failureWithoutVerdict, stderrMessage } from "./signatures.js";

const PROVIDER = "mistral-vibe";
const LABEL = "vibe";

const NO_ANSWER =
  "vibe's stream holds no assistant message with a text block, so there is no answer to read";
const NO_COMPLETION_ANSWER =
  "vibe's stream holds no assistant message with a text block, so there is no completion answer to read";

function providerError(message: string, sessionId: string | null): SessionOutcome {
  return {
    kind: "failure",
    failure: { provider: PROVIDER, kind: "provider-error", message, sessionId, resetAt: null },
  };
}

/** The failure a Vibe export with an outcome other than `finished` reads as. */
function exportFailure(
  exported: VibeOutcomeExport,
  stderr: string,
  sessionId: string | null,
): SessionFailure {
  const code = exported.error?.code ?? null;
  const base =
    exported.error?.message ??
    (stderrMessage(stderr).length > 0 ? stderrMessage(stderr) : exported.outcome);
  const message = code === null ? base : `${base} (${code})`;
  const shaped = (kind: SessionFailure["kind"]): SessionFailure => ({
    provider: PROVIDER,
    kind,
    message,
    sessionId,
    resetAt: null,
  });
  if (exported.outcome === "turn_limit") return shaped("max-turns");
  if (exported.outcome === "terminated" || exported.outcome === "deadline") return shaped("killed");
  if (code === "invalid_api_key") return shaped("provider-error");
  const classified = failureFromText(PROVIDER, base, sessionId);
  const kind = code === "rate_limit" ? "rate-limit" : classified.kind;
  return {
    ...classified,
    kind,
    message,
    resetAt: kind === "rate-limit" || kind === "usage-limit" ? classified.resetAt : null,
  };
}

/** What an export that was not read leaves to say, once the stream and the exit are known. */
function unreadExportOutcome(
  ended: EndedSession,
  message: string,
  sessionId: string | null,
): SessionOutcome {
  if (ended.end.kind === "exited" && ended.end.code === 0) return providerError(message, sessionId);
  return {
    kind: "failure",
    failure: failureWithoutVerdict(PROVIDER, LABEL, ended, sessionId, undefined),
  };
}

/**
 * Reads an ended Mistral Vibe session: its `export.json` outcome decides,
 * whatever the exit code; without one, the process's end and stderr (see
 * outcome.ts). A completion requests no export and answers from the stream.
 */
export function readVibeOutcome(ended: EndedSession, exported: VibeExportRead): SessionOutcome {
  const streamSessionId = findVibeStreamHead(ended.lines)?.sessionId ?? null;
  const found = findVibeResultEvent(ended.lines);

  if (exported.kind === "not-requested") {
    if (ended.end.kind === "exited" && ended.end.code === 0) {
      return found === undefined
        ? providerError(NO_COMPLETION_ANSWER, streamSessionId)
        : { kind: "answer", provider: PROVIDER, text: found.finalText, sessionId: streamSessionId };
    }
    return {
      kind: "failure",
      failure: failureWithoutVerdict(PROVIDER, LABEL, ended, streamSessionId, undefined),
    };
  }

  if (exported.kind === "absent") {
    return unreadExportOutcome(
      ended,
      `vibe wrote no export.json (missing Vibe export at ${exported.path})`,
      streamSessionId,
    );
  }
  if (exported.kind === "unreadable") {
    return unreadExportOutcome(
      ended,
      `could not read the Vibe export at ${exported.path}: ${exported.detail}`,
      streamSessionId,
    );
  }

  const decoded = decodeVibeOutcomeText(exported.text);
  if (Either.isLeft(decoded)) {
    return unreadExportOutcome(
      ended,
      `invalid Vibe export at ${exported.path} (${decoded.left.reason}): ${decoded.left.detail}`,
      streamSessionId,
    );
  }

  const sessionId = decoded.right.session_id ?? streamSessionId;
  if (decoded.right.outcome === "finished") {
    return found === undefined
      ? providerError(NO_ANSWER, sessionId)
      : { kind: "answer", provider: PROVIDER, text: found.finalText, sessionId };
  }
  return { kind: "failure", failure: exportFailure(decoded.right, ended.stderr, sessionId) };
}
