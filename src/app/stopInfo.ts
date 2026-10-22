// What `phax ls` and `phax session-info` print about a run waiting at a stop,
// read from the run's review-stop.json through the schema readers. One
// reader, so the two commands never disagree.
import { Effect } from "effect";
import { join } from "node:path";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import type { FileSystem, FsError } from "../ports/fs.js";
import type { ProviderId } from "../schemas/providerId.js";
import { readReviewStop } from "./interactiveFiles.js";

export interface StopInfo {
  readonly cause: "declared";
  readonly phaseId: string;
  readonly phaseTitle: string;
  /** The stopped phase's place in the plan, one-based, of `of` phases. */
  readonly position: number;
  readonly of: number;
  readonly worktree: string;
  readonly seed: string;
  /** The current session, or null when no first turn answered. */
  readonly session: {
    readonly provider: ProviderId;
    readonly sessionId: string;
    readonly origin: "first-turn" | "new-session";
  } | null;
  /** The command that continues the stop from the main checkout. */
  readonly enterPhase: string;
}

/**
 * The stop a run in `awaiting_review` waits at; null for any other run. The
 * stopped phase is the highest-index phase still awaiting review. A run whose
 * review-stop.json is missing or unreadable fails with an FsError naming it.
 */
export function readStopInfo(
  info: RunReviewInfo,
): Effect.Effect<StopInfo | null, FsError, FileSystem> {
  return Effect.gen(function* () {
    if (info.runState !== "awaiting_review") return null;
    const stopped =
      info.phaseStatuses
        .filter((p) => p.state === "awaiting_review")
        .toSorted((a, b) => b.phaseIndex - a.phaseIndex)[0]?.phaseId ?? info.finalPhaseId;
    const read = yield* readReviewStop(info.runPath, join(info.runPath, stopped));
    if (read === null) return null;
    const { reviewStop } = read;
    return {
      cause: reviewStop.cause,
      phaseId: reviewStop.phase.id,
      phaseTitle: reviewStop.phase.title,
      position: reviewStop.phase.position,
      of: reviewStop.phase.of,
      worktree: reviewStop.worktree,
      seed: reviewStop.seed,
      session:
        reviewStop.session === null
          ? null
          : {
              provider: reviewStop.session.provider,
              sessionId: reviewStop.session.sessionId,
              origin: reviewStop.session.origin,
            },
      enterPhase: reviewStop.commands.enterPhase.argv.join(" "),
    };
  });
}
