import {
  AgentSessionFailedError,
  ArtifactCommitFailedError,
  RateLimitError,
  ReviseDocumentError,
  ReviseRefusedError,
  UsageLimitError,
} from "../domain/errors.js";
import type { RevisionFailure } from "../schemas/revisionRecord.js";

/**
 * The record failure of a revise that ended in `error`, one value per way it
 * can fail. A session failure gives its kind (a limit error its limit kind); a
 * refused answer gives `answer-refused`; the artifact changing during the
 * session gives `artifact-changed`; a failed commit of the revised artifact
 * gives `commit-failed`. Anything else after the writer started (a spawn
 * failure, a missing session id) gives `unknown`.
 */
export function revisionFailureOf(error: unknown): RevisionFailure {
  if (error instanceof AgentSessionFailedError) return error.failure.kind;
  if (error instanceof RateLimitError) return "rate-limit";
  if (error instanceof UsageLimitError) return "usage-limit";
  if (error instanceof ReviseDocumentError) return "answer-refused";
  if (error instanceof ArtifactCommitFailedError) return "commit-failed";
  if (error instanceof ReviseRefusedError && error.reason === "changed") return "artifact-changed";
  return "unknown";
}
