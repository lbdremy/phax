import {
  AgentSessionFailedError,
  ArtifactCommitFailedError,
  DecideDocumentError,
  DecideRefusedError,
  RateLimitError,
  UsageLimitError,
} from "../domain/errors.js";
import type { DecisionFailure } from "../schemas/decisionRecord.js";

/**
 * The record failure of a decide that ended in `error`, one value per way it
 * can fail. A session failure gives its kind (a limit error its limit kind); a
 * refused answer gives `answer-refused`; the artifact changing during the
 * session gives `artifact-changed`; a failed commit of the decided artifact
 * gives `commit-failed`. Anything else after the writer started (a spawn
 * failure, a Vibe refusal) gives `unknown`.
 */
export function decisionFailureOf(error: unknown): DecisionFailure {
  if (error instanceof AgentSessionFailedError) return error.failure.kind;
  if (error instanceof RateLimitError) return "rate-limit";
  if (error instanceof UsageLimitError) return "usage-limit";
  if (error instanceof DecideDocumentError) return "answer-refused";
  if (error instanceof ArtifactCommitFailedError) return "commit-failed";
  if (error instanceof DecideRefusedError && error.reason === "changed") return "artifact-changed";
  return "unknown";
}
