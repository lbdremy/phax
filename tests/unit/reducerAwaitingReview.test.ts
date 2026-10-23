import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodePhaseId, decodeRunId, decodeWorktreePath } from "../../src/domain/branded.js";
import { RateLimitError } from "../../src/domain/errors.js";
import type { PhaxEvent } from "../../src/domain/events.js";
import { interpret } from "../../src/domain/reducer.js";
import type { PhaxState } from "../../src/domain/state.js";
import type { LastClose } from "../../src/schemas/reviewStop.js";
import { reviewStop } from "../helpers/phaseStatusFixture.js";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const run = unwrap(decodeRunId("invoice-export"));
const phaseId = unwrap(decodePhaseId("phase-03"));
const worktreePath = unwrap(decodeWorktreePath("/example/worktrees/invoice-export/phase-03"));
const occurredAt = "2026-10-22T09:30:00.000Z";
const base = { eventId: "evt-1", occurredAt, run, phase: phaseId } as const;

const atStop: PhaxState = {
  run: "awaiting_review",
  phase: { state: "awaiting_review", cause: "declared" },
};
const closing: PhaxState = {
  run: "running",
  phase: { state: "awaiting_review", cause: "declared" },
};
const phaseRunning: PhaxState = { run: "running", phase: { state: "running" } };

const stopReached: PhaxEvent = {
  ...base,
  type: "ReviewStopReached",
  phaseId,
  cause: "declared",
  worktreePath,
  reviewStop: reviewStop(),
};
const gateFailed: LastClose = {
  result: "gate-failed",
  at: occurredAt,
  exitCode: 4,
  log: "/example/runs/invoice-export/phase-03/checks-attempt-01.log",
};

function handled(state: PhaxState, event: PhaxEvent) {
  const disposition = interpret(state, event);
  if (disposition.kind !== "Handled") {
    throw new Error(`expected Handled, got ${disposition.kind}: ${disposition.reason}`);
  }
  return disposition;
}

function archive(force: boolean): PhaxEvent {
  return {
    ...base,
    type: "RunArchiveRequested",
    force,
    from: "/example/runs/invoice-export",
    to: "/example/archive/invoice-export",
  };
}

describe("reaching a declared stop", () => {
  it("moves a running phase to awaiting_review and writes the stop, its instructions and a trace", () => {
    const result = handled(phaseRunning, stopReached);
    expect(result.nextState).toEqual(atStop);
    expect(result.effects).toEqual([
      {
        type: "PersistState",
        patch: {
          run: { stoppedReason: "awaiting_review" },
          phase: { state: "awaiting_review", stop: { cause: "declared", status: "waiting" } },
        },
      },
      { type: "WriteReviewStop", reviewStop: reviewStop() },
      {
        type: "WriteResumeInstructions",
        ctx: {
          reason: "Awaiting review",
          kind: "awaiting_review",
          phaseId,
          worktreePath,
        },
      },
      {
        type: "EmitTrace",
        name: "review.stop.reached",
        status: "info",
        boundary: "review-stop.json",
        details: { phaseId, cause: "declared" },
      },
    ]);
  });

  it("is unexpected from any other phase state of a running run", () => {
    expect(
      interpret({ run: "running", phase: { state: "fixing", attempt: 1 } }, stopReached).kind,
    ).toBe("Unexpected");
  });

  it("is ignored when the run already awaits review", () => {
    expect(interpret(atStop, stopReached).kind).toBe("Ignored");
  });
});

describe("closing a stop", () => {
  it("starts a close on resume: the run runs, the phase stays at the stop, and the document is parked", () => {
    const result = handled(atStop, { ...base, type: "RunResumeRequested" });
    expect(result.nextState).toEqual(closing);
    expect(result.effects).toEqual([
      {
        type: "PersistState",
        patch: { phase: { stop: { cause: "declared", status: "waiting" } } },
      },
      { type: "ParkReviewStop" },
    ]);
  });

  it("returns a refused close to the stop, naming the result, and restores the document", () => {
    const result = handled(closing, {
      ...base,
      type: "StopCloseRefused",
      phaseId,
      lastClose: gateFailed,
    });
    expect(result.nextState).toEqual(atStop);
    expect(result.effects).toEqual([
      {
        type: "PersistState",
        patch: {
          run: {
            stoppedReason: "awaiting_review",
            lastError: "Close of the stop refused: gate-failed (exit 4)",
          },
        },
      },
      { type: "RestoreReviewStop", lastClose: gateFailed },
      {
        type: "WriteResumeInstructions",
        ctx: {
          reason: "Awaiting review",
          kind: "awaiting_review",
          phaseId,
          rawMessage: "Close of the stop refused: gate-failed (exit 4)",
        },
      },
    ]);
  });

  it("returns an interrupted close to the stop with lastClose interrupted, exit 130, at the event's time", () => {
    const result = handled(closing, { ...base, type: "RunInterruptRequested" });
    expect(result.nextState).toEqual(atStop);
    expect(result.effects).toEqual([
      {
        type: "RestoreReviewStop",
        lastClose: { result: "interrupted", at: occurredAt, exitCode: 130 },
      },
      {
        type: "WriteResumeInstructions",
        ctx: {
          reason: "Awaiting review",
          kind: "awaiting_review",
          phaseId,
          rawMessage: "Close of the stop interrupted (exit 130)",
        },
      },
    ]);
  });

  it("commits a closed stop in one event, recording its outcome, and discards the document", () => {
    const result = handled(closing, {
      ...base,
      type: "StopCommitted",
      phaseId,
      hash: "0123456789abcdef0123456789abcdef01234567",
      closure: { outcome: "corrected", oracleStep: "none" },
    });
    expect(result.nextState).toEqual({
      run: "running",
      phase: { state: "committed", hash: "0123456789abcdef0123456789abcdef01234567" },
    });
    expect(result.effects).toEqual([
      {
        type: "PersistState",
        patch: {
          phase: {
            state: "committed",
            commitHash: "0123456789abcdef0123456789abcdef01234567",
            stop: {
              cause: "declared",
              status: "closed",
              outcome: "corrected",
              oracleStep: "none",
            },
          },
        },
      },
      { type: "RecordCommitMetadata", hash: "0123456789abcdef0123456789abcdef01234567" },
      { type: "DiscardReviewStop" },
    ]);
  });

  it("treats a refusal or commit with no close running as stale", () => {
    expect(
      interpret(atStop, { ...base, type: "StopCloseRefused", phaseId, lastClose: gateFailed }).kind,
    ).toBe("Stale");
    expect(
      interpret(atStop, {
        ...base,
        type: "StopCommitted",
        phaseId,
        hash: "abc",
        closure: { outcome: "unchanged" },
      }).kind,
    ).toBe("Stale");
  });

  it("finds a refusal or commit unexpected while an ordinary phase runs", () => {
    expect(
      interpret(phaseRunning, { ...base, type: "StopCloseRefused", phaseId, lastClose: gateFailed })
        .kind,
    ).toBe("Unexpected");
    expect(
      interpret(phaseRunning, {
        ...base,
        type: "StopCommitted",
        phaseId,
        hash: "abc",
        closure: { outcome: "unchanged" },
      }).kind,
    ).toBe("Unexpected");
  });

  it("finds a rate limit unexpected during a close, which reports a limit as a refusal", () => {
    expect(
      interpret(closing, {
        ...base,
        type: "RateLimitDetected",
        kind: "rate_limit",
        cause: new RateLimitError({ message: "rate limited", rawMessage: "rate limited" }),
      }).kind,
    ).toBe("Unexpected");
  });
});

describe("leaving a stop", () => {
  it("archives with force, discarding review-stop.json before the run folder moves", () => {
    const result = handled(atStop, archive(true));
    expect(result.nextState).toEqual({ run: "archived" });
    expect(result.effects.map((effect) => effect.type)).toEqual([
      "DiscardReviewStop",
      "MoveRunToArchive",
    ]);
  });

  it("refuses to archive without force", () => {
    expect(interpret(atStop, archive(false))).toEqual({
      kind: "Rejected",
      reason: "run is awaiting_review, not finished; pass --force to archive it anyway",
    });
  });

  it("resets the phase at the stop to pending and discards the document", () => {
    const result = handled(atStop, { ...base, type: "PhaseResetRequested", phaseId });
    expect(result.nextState).toEqual({ run: "interrupted", phase: { state: "pending" } });
    expect(result.effects).toEqual([
      { type: "PersistState", patch: { run: { stoppedReason: "phase_reset" } } },
      { type: "DiscardReviewStop" },
    ]);
  });

  it("refuses a reset while a close of the stop runs", () => {
    expect(interpret(closing, { ...base, type: "PhaseResetRequested", phaseId })).toEqual({
      kind: "Rejected",
      reason: "a close of the stop is in progress",
    });
  });
});

describe("events while the run awaits review", () => {
  it("ignores an interrupt: nothing is running", () => {
    expect(interpret(atStop, { ...base, type: "RunInterruptRequested" })).toEqual({
      kind: "Ignored",
      reason: "nothing is running while the run awaits review",
    });
  });

  it("rejects starting, failing or completing the run, and starting a phase", () => {
    const events: PhaxEvent[] = [
      { ...base, type: "RunStarted" },
      { ...base, type: "RunFailed", cause: "boom" },
      { ...base, type: "RunCompleted" },
      { ...base, type: "PhaseStartRequested", phaseId },
    ];
    for (const event of events) {
      expect(interpret(atStop, event).kind, event.type).toBe("Rejected");
    }
  });

  it("treats agent, gate, handoff and commit events as stale", () => {
    const events: PhaxEvent[] = [
      { ...base, type: "AgentInvocationStarted" },
      { ...base, type: "GatePassed", attempt: 1 },
      { ...base, type: "HandoffValidated" },
      { ...base, type: "CommitCreated", hash: "abc" },
    ];
    for (const event of events) {
      expect(interpret(atStop, event), event.type).toEqual({
        kind: "Stale",
        reason: `${event.type} while the run awaits review`,
      });
    }
  });
});
