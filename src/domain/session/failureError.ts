import { AgentSessionFailedError, RateLimitError, UsageLimitError } from "../errors.js";
import type { SessionFailure } from "./outcome.js";

/** The files a failed session left: its agent-error.log and its transcript, when it has them. */
export interface SessionFailureFiles {
  readonly agentErrorLog: string | null;
  readonly transcript: string | null;
}

/** `<provider> session failed (<kind>): <provider message>`. */
export function sessionFailureLine(failure: SessionFailure): string {
  return `${failure.provider} session failed (${failure.kind}): ${failure.message}`;
}

/**
 * The one mapping from a failed session to the error it raises, shared by the
 * provider adapters and the fake backend: a limit kind keeps its limit error
 * (so a run still pauses `rate_limited` and exits 8), every other kind is an
 * `AgentSessionFailedError`. Both carry the failure line and the two files.
 */
export function sessionFailureError(
  failure: SessionFailure,
  files: SessionFailureFiles,
): AgentSessionFailedError | RateLimitError | UsageLimitError {
  const message = sessionFailureLine(failure);
  if (failure.kind === "usage-limit" || failure.kind === "rate-limit") {
    const fields = {
      message,
      rawMessage: failure.message,
      resetAt: failure.resetAt ?? undefined,
      agentErrorLog: files.agentErrorLog,
      transcript: files.transcript,
    };
    return failure.kind === "usage-limit"
      ? new UsageLimitError(fields)
      : new RateLimitError(fields);
  }
  return new AgentSessionFailedError({
    message,
    failure,
    agentErrorLog: files.agentErrorLog,
    transcript: files.transcript,
  });
}
