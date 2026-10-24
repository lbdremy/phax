// The transcripts a stop's close copies: which sessions it records, where the
// copy of each sits in the phase folder, how its bytes are hashed and what a
// session looks like once its transcript's outcome is known. Pure: the close
// reads the provider stores and writes the copies.
import { createHash } from "node:crypto";
import type { ProviderId } from "../routing/types.js";

/** The folder of a phase folder that holds a stop's transcript copies. */
export const TRANSCRIPTS_FOLDER = "interactive-transcripts";

/** The part of a recorded session a transcript copy needs. */
export interface RecordedSession {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly sessionId: string;
  readonly startedAt: string;
  readonly origin: "first-turn" | "new-session" | "builder";
}

/** How a recorded session's transcript came out at a close. */
export type TranscriptOutcome =
  | { readonly status: "captured"; readonly sha256: string }
  | {
      readonly status: "missing";
      readonly reason: "not-found" | "unreadable";
      readonly detail: string;
    };

/** A recorded session with its transcript's outcome: the record's session, key for key. */
export interface ClosedStopSession {
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly sessionId: string;
  readonly origin: "first-turn" | "new-session" | "builder";
  readonly transcript: TranscriptOutcome;
}

/**
 * The sessions a stop recorded, oldest first: the `history` then the
 * `current` one, each session id once (the first entry of an id wins).
 */
export function recordedSessions(session: {
  readonly current: RecordedSession | null;
  readonly history: readonly RecordedSession[];
}): readonly RecordedSession[] {
  const seen = new Set<string>();
  const all = session.current === null ? session.history : [...session.history, session.current];
  return all.filter((s) => {
    if (seen.has(s.sessionId)) return false;
    seen.add(s.sessionId);
    return true;
  });
}

/**
 * A session id that may be joined into a path: it starts with a letter or
 * digit and holds only letters, digits, `.`, `_` and `-`, so `.`, `..` and
 * any slash are refused. The one definition: the documents' schemas, the
 * provider store adapters and the close's copies all test ids against it.
 */
export const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Whether `sessionId` may be joined into a path (see SAFE_SESSION_ID). */
export function isSafeSessionId(sessionId: string): boolean {
  return SAFE_SESSION_ID.test(sessionId);
}

/** The outcome of a session whose id is unsafe: no path is built from it, nothing is read. */
export const UNSAFE_SESSION_ID_TRANSCRIPT: TranscriptOutcome = {
  status: "missing",
  reason: "unreadable",
  detail: "unsafe session id",
};

/**
 * The copy of a session's transcript, relative to the phase folder; null
 * when the id is unsafe, so no path is ever built from it.
 */
export function transcriptFile(sessionId: string): string | null {
  return isSafeSessionId(sessionId) ? `${TRANSCRIPTS_FOLDER}/${sessionId}.jsonl` : null;
}

/** The sha256 of `bytes`, in hex: of the bytes, never of a decoded string. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
