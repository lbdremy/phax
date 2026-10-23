// The held cause in the reducer (plan held-stop-and-oracle-pair-reviews,
// phase-02): reaching a held stop, closing it with HeldStopClosed, and pausing
// a failed hold point. Fixtures are made up: the invoice-export run.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodePhaseId, decodeRunId, decodeWorktreePath } from "../../src/domain/branded.js";
import type { PhaxEvent, PhaxEventType } from "../../src/domain/events.js";
import { phaxDispositionMatrix } from "../../src/domain/matrix.js";
import { interpret } from "../../src/domain/reducer.js";
import type { PhaxState, PhaxStateName } from "../../src/domain/state.js";
import type { LastClose } from "../../src/schemas/reviewStop.js";
import { heldReviewStop, reviewStop } from "../helpers/phaseStatusFixture.js";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const run = unwrap(decodeRunId("invoice-export"));
const phaseId = unwrap(decodePhaseId("phase-02"));
const worktreePath = unwrap(decodeWorktreePath("/example/worktrees/invoice-export/phase-02"));
const occurredAt = "2026-10-23T09:30:00.000Z";
const base = { eventId: "evt-1", occurredAt, run, phase: phaseId } as const;

const PHASE_COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const REVIEW_COMMIT = "b2c3d4e5f60718293a4b5c6d7e8f9012345678a1";

const committed: PhaxState = {
  run: "running",
  phase: { state: "committed", hash: PHASE_COMMIT },
};
const handoffFailed: PhaxState = {
  run: "running",
  phase: { state: "handoff_failed", missing: ["## Summary"] },
};
const phaseRunning: PhaxState = { run: "running", phase: { state: "running" } };
const heldAtStop: PhaxState = {
  run: "awaiting_review",
  phase: { state: "awaiting_review", cause: "held" },
};
const heldClosing: PhaxState = {
  run: "running",
  phase: { state: "awaiting_review", cause: "held" },
};
const declaredAtStop: PhaxState = {
  run: "awaiting_review",
  phase: { state: "awaiting_review", cause: "declared" },
};
const declaredClosing: PhaxState = {
  run: "running",
  phase: { state: "awaiting_review", cause: "declared" },
};

const heldReached: PhaxEvent = {
  ...base,
  type: "ReviewStopReached",
  phaseId,
  cause: "held",
  worktreePath,
  reviewStop: heldReviewStop({ phaseCommit: PHASE_COMMIT }),
};
const declaredReached: PhaxEvent = {
  ...base,
  type: "ReviewStopReached",
  phaseId,
  cause: "declared",
  worktreePath,
  reviewStop: reviewStop(),
};
const heldClosedCorrected: PhaxEvent = {
  ...base,
  type: "HeldStopClosed",
  phaseId,
  phaseCommit: PHASE_COMMIT,
  closure: { outcome: "corrected", reviewCommit: REVIEW_COMMIT, oracleStep: "authored" },
};
const heldClosedUnchanged: PhaxEvent = {
  ...base,
  type: "HeldStopClosed",
  phaseId,
  phaseCommit: PHASE_COMMIT,
  closure: { outcome: "unchanged" },
};
const holdPointFailed: PhaxEvent = {
  ...base,
  type: "HoldPointFailed",
  phaseId,
  phaseCommit: PHASE_COMMIT,
  worktreePath,
  reason: "the review seed could not be written",
};
const gateFailed: LastClose = {
  result: "gate-failed",
  at: occurredAt,
  exitCode: 4,
  log: "/example/runs/invoice-export/phase-02/review-gate/checks-attempt-01.log",
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

describe("reaching a held stop", () => {
  it.each([
    ["a committed phase", committed],
    ["a phase whose resumed handoff just passed", handoffFailed],
  ])("moves %s to awaiting_review held, with exactly four effects", (_name, from) => {
    const result = handled(from, heldReached);
    expect(result.nextState).toEqual(heldAtStop);
    expect(result.effects).toEqual([
      {
        type: "PersistState",
        patch: {
          run: { stoppedReason: "awaiting_review" },
          phase: { state: "awaiting_review", stop: { cause: "held", status: "waiting" } },
        },
      },
      { type: "WriteReviewStop", reviewStop: heldReviewStop({ phaseCommit: PHASE_COMMIT }) },
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
        details: { phaseId, cause: "held" },
      },
    ]);
    expect(result.effects.map((effect) => effect.type)).toEqual([
      "PersistState",
      "WriteReviewStop",
      "WriteResumeInstructions",
      "EmitTrace",
    ]);
  });

  it("is ignored when the run already awaits review, for either cause", () => {
    expect(interpret(heldAtStop, heldReached).kind).toBe("Ignored");
    expect(interpret(declaredAtStop, declaredReached).kind).toBe("Ignored");
  });

  it("keeps a declared stop reachable from the running phase only", () => {
    expect(handled(phaseRunning, declaredReached).nextState).toEqual(declaredAtStop);
    expect(interpret(committed, declaredReached).kind).toBe("Unexpected");
    expect(interpret(handoffFailed, declaredReached).kind).toBe("Unexpected");
  });
});

describe("a stop that is unexpected", () => {
  it.each([
    ["a held stop from the running phase", phaseRunning, heldReached],
    [
      "a held stop from a fixing phase",
      { run: "running", phase: { state: "fixing", attempt: 1 } },
      heldReached,
    ],
    ["a declared stop from a committed phase", committed, declaredReached],
    [
      "a held event carrying a declared review stop",
      committed,
      { ...heldReached, reviewStop: reviewStop() },
    ],
    [
      "a declared event carrying a held review stop",
      phaseRunning,
      { ...declaredReached, reviewStop: heldReviewStop() },
    ],
    ["HeldStopClosed on a declared stop", declaredClosing, heldClosedUnchanged],
    [
      "StopCommitted on a held stop",
      heldClosing,
      {
        ...base,
        type: "StopCommitted",
        phaseId,
        hash: REVIEW_COMMIT,
        closure: { outcome: "unchanged" },
      },
    ],
    ["HeldStopClosed while an ordinary phase runs", phaseRunning, heldClosedUnchanged],
    ["HoldPointFailed while an ordinary phase runs", phaseRunning, holdPointFailed],
  ] as const)("finds %s unexpected", (_name, state, event) => {
    expect(interpret(state as PhaxState, event as PhaxEvent).kind).toBe("Unexpected");
  });

  it("names the cause and the state of a held stop reached from the wrong phase state", () => {
    expect(interpret(phaseRunning, heldReached)).toEqual({
      kind: "Unexpected",
      reason: "held review stop reached while phase is running",
    });
  });
});

describe("closing a held stop", () => {
  it("starts a close on resume: the phase stays at the held stop and the document is parked", () => {
    const result = handled(heldAtStop, { ...base, type: "RunResumeRequested" });
    expect(result.nextState).toEqual(heldClosing);
    expect(result.effects).toEqual([
      { type: "PersistState", patch: { phase: { stop: { cause: "held", status: "waiting" } } } },
      { type: "ParkReviewStop" },
    ]);
  });

  it("records a corrected close beside the phase commit, which stays commitHash", () => {
    const result = handled(heldClosing, heldClosedCorrected);
    expect(result.nextState).toEqual({
      run: "running",
      phase: { state: "committed", hash: PHASE_COMMIT },
    });
    expect(result.effects).toEqual([
      {
        type: "PersistState",
        patch: {
          phase: {
            state: "committed",
            stop: {
              cause: "held",
              status: "closed",
              outcome: "corrected",
              reviewCommit: REVIEW_COMMIT,
              oracleStep: "authored",
            },
          },
        },
      },
      { type: "DiscardReviewStop" },
    ]);
  });

  it("records an unchanged close with no review commit", () => {
    const result = handled(heldClosing, heldClosedUnchanged);
    expect(result.nextState).toEqual({
      run: "running",
      phase: { state: "committed", hash: PHASE_COMMIT },
    });
    expect(result.effects).toEqual([
      {
        type: "PersistState",
        patch: {
          phase: {
            state: "committed",
            stop: { cause: "held", status: "closed", outcome: "unchanged" },
          },
        },
      },
      { type: "DiscardReviewStop" },
    ]);
  });

  it.each([
    ["corrected", heldClosedCorrected],
    ["unchanged", heldClosedUnchanged],
  ])("never writes commit metadata or a commitHash for a %s close", (_name, event) => {
    const result = handled(heldClosing, event);
    expect(result.effects.map((effect) => effect.type)).not.toContain("RecordCommitMetadata");
    for (const effect of result.effects) {
      if (effect.type === "PersistState")
        expect(effect.patch.phase).not.toHaveProperty("commitHash");
    }
  });

  it("is stale when no close runs", () => {
    expect(interpret(heldAtStop, heldClosedUnchanged).kind).toBe("Stale");
  });

  it("closes a declared stop with StopCommitted, recording its oracle step", () => {
    const result = handled(declaredClosing, {
      ...base,
      type: "StopCommitted",
      phaseId,
      hash: REVIEW_COMMIT,
      closure: { outcome: "corrected", oracleStep: "authored" },
    });
    expect(result.effects).toEqual([
      {
        type: "PersistState",
        patch: {
          phase: {
            state: "committed",
            commitHash: REVIEW_COMMIT,
            stop: {
              cause: "declared",
              status: "closed",
              outcome: "corrected",
              oracleStep: "authored",
            },
          },
        },
      },
      { type: "RecordCommitMetadata", hash: REVIEW_COMMIT },
      { type: "DiscardReviewStop" },
    ]);
  });
});

describe("a failed hold point", () => {
  it.each([
    ["a committed phase", committed],
    ["a phase whose resumed handoff just passed", handoffFailed],
  ])("pauses the run interrupted with %s still committed", (_name, from) => {
    const result = handled(from, holdPointFailed);
    expect(result.nextState).toEqual({
      run: "interrupted",
      phase: { state: "committed", hash: PHASE_COMMIT },
    });
    expect(result.effects).toEqual([
      {
        type: "PersistState",
        patch: {
          run: {
            stoppedReason: "hold_point_failed",
            lastError: "the review seed could not be written",
          },
          phase: { state: "committed" },
        },
      },
      {
        type: "WriteResumeInstructions",
        ctx: {
          reason: "Hold point failed",
          kind: "hold_point_failed",
          phaseId,
          worktreePath,
          rawMessage: "the review seed could not be written",
        },
      },
      {
        type: "EmitTrace",
        name: "hold.point.failed",
        status: "failed",
        boundary: "hold-point",
        details: { phaseId, reason: "the review seed could not be written" },
      },
      {
        type: "EmitTrace",
        name: "resume.available",
        status: "info",
        boundary: "resume-instructions.md",
        details: { resumeCommand: "phax resume invoice-export" },
      },
    ]);
  });

  it("is stale on a run that is not running", () => {
    expect(interpret(heldAtStop, holdPointFailed).kind).toBe("Stale");
    expect(
      interpret(
        { run: "interrupted", phase: { state: "committed", hash: PHASE_COMMIT } },
        holdPointFailed,
      ).kind,
    ).toBe("Stale");
  });
});

describe("a held stop keeps plan 1's verdicts on events other than its own", () => {
  const cases: ReadonlyArray<readonly [string, PhaxState, PhaxEvent]> = [
    ["RunResumeRequested", heldAtStop, { ...base, type: "RunResumeRequested" }],
    ["RunInterruptRequested at the stop", heldAtStop, { ...base, type: "RunInterruptRequested" }],
    [
      "PhaseResetRequested at the stop",
      heldAtStop,
      { ...base, type: "PhaseResetRequested", phaseId },
    ],
    ["RunArchiveRequested with force", heldAtStop, archive(true)],
    ["RunArchiveRequested without force", heldAtStop, archive(false)],
    [
      "StopCloseRefused while a close runs",
      heldClosing,
      { ...base, type: "StopCloseRefused", phaseId, lastClose: gateFailed },
    ],
    [
      "RunInterruptRequested during a close",
      heldClosing,
      { ...base, type: "RunInterruptRequested" },
    ],
    [
      "PhaseResetRequested during a close",
      heldClosing,
      { ...base, type: "PhaseResetRequested", phaseId },
    ],
  ];

  it.each(cases)("%s gives the declared stop's verdict", (_name, state, event) => {
    const counterpart: PhaxState =
      state === heldAtStop ? declaredAtStop : state === heldClosing ? declaredClosing : state;
    const held = interpret(state, event);
    const plain = interpret(counterpart, event);
    expect(held.kind).toBe(plain.kind);
    if (held.kind === "Handled" && plain.kind === "Handled") {
      expect(held.effects.map((effect) => effect.type)).toEqual(
        plain.effects.map((effect) => effect.type),
      );
    }
  });

  it("resumes into a close, archives with force and resets, as at a declared stop", () => {
    expect(handled(heldAtStop, archive(true)).nextState).toEqual({ run: "archived" });
    expect(interpret(heldAtStop, archive(false)).kind).toBe("Rejected");
    expect(
      handled(heldAtStop, { ...base, type: "PhaseResetRequested", phaseId }).nextState,
    ).toEqual({ run: "interrupted", phase: { state: "pending" } });
    expect(interpret(heldClosing, { ...base, type: "PhaseResetRequested", phaseId }).kind).toBe(
      "Rejected",
    );
  });

  it("returns a refused close to the held stop and restores the document", () => {
    const result = handled(heldClosing, {
      ...base,
      type: "StopCloseRefused",
      phaseId,
      lastClose: gateFailed,
    });
    expect(result.nextState).toEqual(heldAtStop);
    expect(result.effects.map((effect) => effect.type)).toEqual([
      "PersistState",
      "RestoreReviewStop",
      "WriteResumeInstructions",
    ]);
  });

  it("returns an interrupted close to the held stop with lastClose interrupted", () => {
    const result = handled(heldClosing, { ...base, type: "RunInterruptRequested" });
    expect(result.nextState).toEqual(heldAtStop);
    expect(result.effects[0]).toEqual({
      type: "RestoreReviewStop",
      lastClose: { result: "interrupted", at: occurredAt, exitCode: 130 },
    });
  });
});

describe("the matrix cells of the held cause", () => {
  const representative: { readonly [K in PhaxStateName]: PhaxState } = {
    created: { run: "created" },
    running: phaseRunning,
    rate_limited: { run: "rate_limited", phase: { state: "rate_limited" } },
    interrupted: { run: "interrupted", phase: { state: "committed", hash: PHASE_COMMIT } },
    review_open: { run: "review_open", phase: { state: "review_open" } },
    failed: { run: "failed", cause: "boom" },
    completed: { run: "completed" },
    stopped: { run: "stopped" },
    archived: { run: "archived" },
    awaiting_review: heldAtStop,
  };
  // Events a running run handles only from one phase state are walked from it.
  const runningFor: Partial<Record<PhaxEventType, PhaxState>> = {
    HeldStopClosed: heldClosing,
    HoldPointFailed: committed,
  };
  const events: ReadonlyArray<readonly [PhaxEventType, PhaxEvent]> = [
    ["HeldStopClosed", heldClosedCorrected],
    ["HoldPointFailed", holdPointFailed],
    ["ReviewStopReached", declaredReached],
  ];
  const states = Object.keys(representative) as readonly PhaxStateName[];
  const cells = states.flatMap((runState) => events.map((entry) => [runState, ...entry] as const));

  it.each(cells)("%s × %s gives the matrix's disposition", (runState, type, event) => {
    const state =
      (runState === "running" ? runningFor[type] : undefined) ?? representative[runState];
    const disposition = interpret(state, event);
    expect(disposition.kind, `${runState} × ${type} — reducer returned ${disposition.kind}`).toBe(
      phaxDispositionMatrix[runState][type],
    );
  });

  it("gives a held ReviewStopReached the same matrix cells as a declared one", () => {
    const rows = states.map((runState) => {
      const state = runState === "running" ? committed : representative[runState];
      return [runState, interpret(state, heldReached).kind] as const;
    });
    const declaredRows = states.map((runState) => {
      const state = representative[runState];
      return [runState, interpret(state, declaredReached).kind] as const;
    });
    // Both causes are handled from running, ignored while the run awaits review and
    // stale or unexpected elsewhere, exactly as the matrix records for the event.
    for (const [runState, kind] of rows) {
      if (runState === "running") expect(kind).toBe("Handled");
      else expect(kind).toBe(phaxDispositionMatrix[runState].ReviewStopReached);
    }
    for (const [runState, kind] of declaredRows) {
      if (runState !== "running")
        expect(kind).toBe(phaxDispositionMatrix[runState].ReviewStopReached);
    }
  });
});
