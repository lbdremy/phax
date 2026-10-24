import { Either } from "effect";
import { describe, expect, it } from "vitest";
import type { ClosedStopSession } from "../../../src/domain/interactive/transcripts.js";
import {
  recordStopFromPersisted,
  recordStopOf,
  type StopRecordFacts,
} from "../../../src/domain/records/stopRecord.js";
import type { InteractiveSession } from "../../../src/schemas/interactiveSession.js";
import type { PhaseStop } from "../../../src/schemas/status.js";

// The stop of a phase record, from a close as it happens and from what a
// closed stop left on disk: the invoice-export run's held phase-02 (builder
// X0, review commit R2) and declared phase-03 (first turn X1).

const ADA = { name: "Ada Example", email: "ada@example.test" };
const R2 = "2".repeat(40);
const SHA_X0 = "a".repeat(64);
const SHA_X1 = "b".repeat(64);

const X0: ClosedStopSession = {
  provider: "codex-cli",
  model: "gpt-5.5",
  effort: "high",
  sessionId: "X0",
  origin: "builder",
  transcript: { status: "captured", sha256: SHA_X0 },
};
const X1: ClosedStopSession = {
  provider: "codex-cli",
  model: "gpt-5.5",
  effort: "medium",
  sessionId: "X1",
  origin: "first-turn",
  transcript: { status: "missing", reason: "not-found", detail: "no rollout for X1" },
};

const recorded = (session: ClosedStopSession) => ({
  provider: session.provider,
  model: session.model,
  effort: session.effort,
  sessionId: session.sessionId,
  startedAt: "2026-10-24T09:00:00.000Z",
  origin: session.origin,
});

function sessionDoc(
  sessions: readonly ClosedStopSession[],
  transcripts: InteractiveSession["transcripts"],
): InteractiveSession {
  const current = sessions.at(-1);
  return {
    phaseId: "phase-03",
    provider: "codex-cli",
    interactiveResume: "verified",
    current: current === undefined ? null : recorded(current),
    history: sessions.slice(0, -1).map(recorded),
    firstTurns: [],
    turnInProgress: null,
    transcripts,
    builderUsage: null,
  };
}

const entries = (sessions: readonly ClosedStopSession[]) =>
  sessions.map((s) => ({ sessionId: s.sessionId, ...s.transcript }));

describe("recordStopOf", () => {
  it.each<readonly [string, StopRecordFacts, object]>([
    [
      "a held corrected close, with its review commit",
      { cause: "held", outcome: "corrected", reviewCommit: R2, closedBy: ADA, sessions: [X0] },
      { cause: "held", outcome: "corrected", reviewCommit: R2, closedBy: ADA, sessions: [X0] },
    ],
    [
      "a held unchanged close",
      { cause: "held", outcome: "unchanged", closedBy: ADA, sessions: [X0] },
      { cause: "held", outcome: "unchanged", closedBy: ADA, sessions: [X0] },
    ],
    [
      "a declared corrected close",
      { cause: "declared", outcome: "corrected", closedBy: ADA, sessions: [X1] },
      { cause: "declared", outcome: "corrected", closedBy: ADA, sessions: [X1] },
    ],
    [
      "a declared unchanged close with no session",
      { cause: "declared", outcome: "unchanged", closedBy: ADA, sessions: [] },
      { cause: "declared", outcome: "unchanged", closedBy: ADA, sessions: [] },
    ],
  ])("gives %s exactly its variant's keys", (_name, facts, expected) => {
    expect(recordStopOf(facts)).toStrictEqual(expected);
  });

  it("names a review commit only on a held corrected close", () => {
    const stops = [
      recordStopOf({ cause: "held", outcome: "unchanged", closedBy: ADA, sessions: [] }),
      recordStopOf({ cause: "declared", outcome: "corrected", closedBy: ADA, sessions: [] }),
      recordStopOf({ cause: "declared", outcome: "unchanged", closedBy: ADA, sessions: [] }),
    ];
    for (const stop of stops) expect(stop).not.toHaveProperty("reviewCommit");
  });

  it("copies no key a close report carries beyond the record's", () => {
    const report = {
      cause: "held" as const,
      outcome: "corrected" as const,
      reviewCommit: R2,
      phaseCommit: "c".repeat(40),
      unjudgedOracleFiles: [],
      closedBy: { ...ADA },
      sessions: [{ ...X0, startedAt: "2026-10-24T09:00:00.000Z" }],
      handoffSource: "person" as const,
    };
    expect(recordStopOf(report)).toStrictEqual({
      cause: "held",
      outcome: "corrected",
      reviewCommit: R2,
      closedBy: ADA,
      sessions: [X0],
    });
  });
});

describe("recordStopFromPersisted", () => {
  const heldCorrected: PhaseStop = {
    cause: "held",
    status: "closed",
    outcome: "corrected",
    reviewCommit: R2,
    oracleStep: "none",
    closedBy: ADA,
  };
  const declaredUnchanged: PhaseStop = {
    cause: "declared",
    status: "closed",
    outcome: "unchanged",
    closedBy: ADA,
  };

  it.each<readonly [string, PhaseStop, readonly ClosedStopSession[], object]>([
    [
      "a held corrected stop",
      heldCorrected,
      [X0],
      { cause: "held", outcome: "corrected", reviewCommit: R2, closedBy: ADA, sessions: [X0] },
    ],
    [
      "a held unchanged stop",
      { cause: "held", status: "closed", outcome: "unchanged", closedBy: ADA },
      [X0],
      { cause: "held", outcome: "unchanged", closedBy: ADA, sessions: [X0] },
    ],
    [
      "a declared corrected stop",
      {
        cause: "declared",
        status: "closed",
        outcome: "corrected",
        oracleStep: "none",
        closedBy: ADA,
      },
      [X1],
      { cause: "declared", outcome: "corrected", closedBy: ADA, sessions: [X1] },
    ],
    [
      "a declared unchanged stop with no session",
      declaredUnchanged,
      [],
      { cause: "declared", outcome: "unchanged", closedBy: ADA, sessions: [] },
    ],
  ])("gives %s from its status and its sessions", (_name, stop, sessions, expected) => {
    const doc = sessionDoc(sessions, entries(sessions));
    expect(Either.getOrThrow(recordStopFromPersisted(stop, doc))).toStrictEqual(expected);
  });

  it("names the sessions oldest first, each once, with their transcripts", () => {
    const X2: ClosedStopSession = {
      ...X1,
      sessionId: "X2",
      origin: "new-session",
      transcript: { status: "captured", sha256: SHA_X1 },
    };
    const doc = { ...sessionDoc([X1, X2], entries([X2, X1])), history: [recorded(X1)] };
    const stop = Either.getOrThrow(recordStopFromPersisted(declaredUnchanged, doc));
    expect(stop.sessions).toEqual([X1, X2]);
  });

  it("gives no session when the phase has no interactive-session.json", () => {
    const stop = Either.getOrThrow(recordStopFromPersisted(declaredUnchanged, null));
    expect(stop.sessions).toEqual([]);
  });

  it("refuses a document whose transcripts is null: its close never captured them", () => {
    const result = recordStopFromPersisted(heldCorrected, sessionDoc([X0], null));
    expect(Either.isLeft(result)).toBe(true);
  });

  it("refuses a recorded session with no transcript entry", () => {
    const result = recordStopFromPersisted(heldCorrected, sessionDoc([X0], []));
    expect(Either.isLeft(result)).toBe(true);
  });

  it("refuses a stop that is not closed", () => {
    const doc = sessionDoc([X0], entries([X0]));
    expect(Either.isLeft(recordStopFromPersisted(null, doc))).toBe(true);
    expect(Either.isLeft(recordStopFromPersisted({ cause: "held", status: "waiting" }, doc))).toBe(
      true,
    );
  });
});
