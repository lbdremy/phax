// The `stop` of a phase record's manifest: built from a close as it happens,
// or from what a closed stop left on disk when its record is written by a
// later resume. Pure: the caller reads the files.
import { Either } from "effect";
import {
  recordedSessions,
  type ClosedStopSession,
  type TranscriptOutcome,
} from "../interactive/transcripts.js";
import type { InteractiveSession } from "../../schemas/interactiveSession.js";
import type { RecordStop, RecordStopSession } from "../../schemas/runRecord.js";
import type { PhaseStop } from "../../schemas/status.js";

interface Closer {
  readonly name: string;
  readonly email: string;
}

/** What a close came to, as the record names it: only a held correction has a review commit. */
export type StopRecordFacts =
  | {
      readonly cause: "declared";
      readonly outcome: "corrected" | "unchanged";
      readonly closedBy: Closer;
      readonly sessions: readonly ClosedStopSession[];
    }
  | {
      readonly cause: "held";
      readonly outcome: "corrected";
      readonly reviewCommit: string;
      readonly closedBy: Closer;
      readonly sessions: readonly ClosedStopSession[];
    }
  | {
      readonly cause: "held";
      readonly outcome: "unchanged";
      readonly closedBy: Closer;
      readonly sessions: readonly ClosedStopSession[];
    };

function sessionOf(session: ClosedStopSession): RecordStopSession {
  return {
    provider: session.provider,
    model: session.model,
    effort: session.effort,
    sessionId: session.sessionId,
    origin: session.origin,
    transcript: transcriptOf(session.transcript),
  };
}

function transcriptOf(outcome: TranscriptOutcome): RecordStopSession["transcript"] {
  return outcome.status === "captured"
    ? { status: "captured", sha256: outcome.sha256 }
    : { status: "missing", reason: outcome.reason, detail: outcome.detail };
}

/** The manifest's `stop` for a close: exactly the keys of its variant, never another. */
export function recordStopOf(facts: StopRecordFacts): NonNullable<RecordStop> {
  const closedBy = { name: facts.closedBy.name, email: facts.closedBy.email };
  const sessions = facts.sessions.map(sessionOf);
  if (facts.cause === "declared") {
    return { cause: "declared", outcome: facts.outcome, closedBy, sessions };
  }
  if (facts.outcome === "corrected") {
    return {
      cause: "held",
      outcome: "corrected",
      reviewCommit: facts.reviewCommit,
      closedBy,
      sessions,
    };
  }
  return { cause: "held", outcome: "unchanged", closedBy, sessions };
}

/**
 * The manifest's `stop` from a closed status `stop` and the phase's
 * interactive-session document, for a record a later resume writes. A
 * document whose `transcripts` is null was never closed, so it is refused, as
 * is a recorded session with no transcript entry. No document means the stop
 * recorded no session, as at the close.
 */
export function recordStopFromPersisted(
  stop: PhaseStop,
  session: InteractiveSession | null,
): Either.Either<NonNullable<RecordStop>, string> {
  if (stop === null || stop.status !== "closed") {
    return Either.left("the phase's stop is not closed");
  }
  const sessions: ClosedStopSession[] = [];
  if (session !== null) {
    const { transcripts } = session;
    if (transcripts === null) {
      return Either.left("interactive-session.json names no transcript: the close never ran");
    }
    for (const recorded of recordedSessions(session)) {
      const entry = transcripts.find((t) => t.sessionId === recorded.sessionId);
      if (entry === undefined) {
        return Either.left(
          `interactive-session.json names no transcript for session ${recorded.sessionId}`,
        );
      }
      sessions.push({
        provider: recorded.provider,
        model: recorded.model,
        effort: recorded.effort,
        sessionId: recorded.sessionId,
        origin: recorded.origin,
        transcript:
          entry.status === "captured"
            ? { status: "captured", sha256: entry.sha256 }
            : { status: "missing", reason: entry.reason, detail: entry.detail },
      });
    }
  }
  const closedBy = stop.closedBy;
  if (stop.cause === "declared") {
    return Either.right(
      recordStopOf({ cause: "declared", outcome: stop.outcome, closedBy, sessions }),
    );
  }
  return Either.right(
    stop.outcome === "corrected"
      ? recordStopOf({
          cause: "held",
          outcome: "corrected",
          reviewCommit: stop.reviewCommit,
          closedBy,
          sessions,
        })
      : recordStopOf({ cause: "held", outcome: "unchanged", closedBy, sessions }),
  );
}
