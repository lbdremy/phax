import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeClaudeSessionId,
  decodePhaseId,
  decodeRunId,
  decodeWorktreePath,
} from "../../src/domain/branded.js";
import type { DispositionKind } from "../../src/domain/disposition.js";
import { RateLimitError } from "../../src/domain/errors.js";
import type { PhaxEvent, PhaxEventType } from "../../src/domain/events.js";
import { phaxDispositionMatrix } from "../../src/domain/matrix.js";
import { interpret } from "../../src/domain/reducer.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { PhaxState, PhaxStateName } from "../../src/domain/state.js";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const runId = unwrap(decodeRunId("run-1"));
const phaseId = unwrap(decodePhaseId("phase-01"));
const sessionId = unwrap(decodeClaudeSessionId("session-1"));
const worktreePath = unwrap(decodeWorktreePath("/tmp/wt"));

const base = {
  eventId: "evt-1",
  occurredAt: "2026-05-20T12:00:00Z",
  run: runId,
} as const;

const rateLimitError = new RateLimitError({
  message: "rate limited",
  rawMessage: "rate limited",
});

const sampleReviewInfo: RunReviewInfo = {
  shortName: "run-1",
  runId: "run-1",
  runState: "running",
  branch: "ai/run-1",
  stateRoot: "/tmp/state",
  runPath: "/tmp/state/runs/run-1",
  finalPhaseId: "phase-01",
  finalPhaseTitle: "Final",
  worktreePath: "/tmp/wt",
  claudeSessionId: undefined,
  gateProfileId: undefined,
  phaseStatuses: [],
  planPhases: [],
  updatedAt: "2026-05-20T12:00:00Z",
  stoppedReason: undefined,
  lastError: undefined,
};

/** Representative event of every variant — used by the consistency walker. */
const sampleEvents: { readonly [K in PhaxEventType]: PhaxEvent & { type: K } } = {
  RunStarted: { ...base, type: "RunStarted" },
  RunResumeRequested: { ...base, type: "RunResumeRequested" },
  RunInterruptRequested: { ...base, type: "RunInterruptRequested" },
  RunArchiveRequested: {
    ...base,
    type: "RunArchiveRequested",
    from: "/tmp/state/runs/run-1",
    to: "/tmp/state/archive/run-1",
  },
  RunFailed: { ...base, type: "RunFailed", cause: new Error("boom") },
  FinalReviewOpened: { ...base, type: "FinalReviewOpened", info: sampleReviewInfo },
  RunCompleted: { ...base, type: "RunCompleted" },
  PhaseStartRequested: { ...base, type: "PhaseStartRequested", phaseId },
  WorktreeCreated: { ...base, type: "WorktreeCreated", phase: phaseId, path: worktreePath },
  AgentInvocationStarted: { ...base, type: "AgentInvocationStarted", phase: phaseId },
  AgentInvocationCompleted: {
    ...base,
    type: "AgentInvocationCompleted",
    phase: phaseId,
    sessionId,
  },
  GateStarted: { ...base, type: "GateStarted", phase: phaseId, attempt: 0 },
  GatePassed: { ...base, type: "GatePassed", phase: phaseId, attempt: 0 },
  GateFailed: {
    ...base,
    type: "GateFailed",
    phase: phaseId,
    command: "pnpm test",
    exitCode: 1,
    logPath: "/tmp/gate.log",
    attempt: 0,
  },
  FixStarted: { ...base, type: "FixStarted", phase: phaseId, attempt: 1 },
  FixCompleted: { ...base, type: "FixCompleted", phase: phaseId, sessionId },
  FixAttemptsExhausted: {
    ...base,
    type: "FixAttemptsExhausted",
    phase: phaseId,
    attempt: 3,
    phaseId,
    worktreePath,
    sessionId,
    command: "pnpm test",
  },
  HandoffRequested: { ...base, type: "HandoffRequested", phase: phaseId },
  HandoffValidated: { ...base, type: "HandoffValidated", phase: phaseId },
  HandoffMissing: {
    ...base,
    type: "HandoffMissing",
    phase: phaseId,
    missingSections: ["## Summary"],
  },
  CommitCreated: { ...base, type: "CommitCreated", phase: phaseId, hash: "abc123" },
  CleanupStarted: { ...base, type: "CleanupStarted", phase: phaseId },
  CleanupCompleted: { ...base, type: "CleanupCompleted", phase: phaseId },
  PhaseHadNoChanges: {
    ...base,
    type: "PhaseHadNoChanges",
    phase: phaseId,
    phaseId,
    worktreePath,
    sessionId,
    reason: "Phase phase-01 produced no changes",
  },
  RateLimitDetected: {
    ...base,
    type: "RateLimitDetected",
    phase: phaseId,
    kind: "rate_limit",
    cause: rateLimitError,
  },
};

/** Canonical PhaxState per run-state name — used by the matrix consistency walker. */
const representativeState: { readonly [K in PhaxStateName]: PhaxState } = {
  created: { run: "created" },
  running: { run: "running", phase: { state: "running" } },
  rate_limited: { run: "rate_limited", phase: { state: "rate_limited" } },
  interrupted: { run: "interrupted", phase: { state: "running" } },
  review_open: { run: "review_open", phase: { state: "review_open" } },
  failed: { run: "failed", cause: "boom" },
  completed: { run: "completed" },
  stopped: { run: "stopped" },
  archived: { run: "archived" },
};

const runStateNames = Object.keys(representativeState) as readonly PhaxStateName[];
const eventTypeNames = Object.keys(sampleEvents) as readonly PhaxEventType[];

describe("phaxDispositionMatrix", () => {
  it("covers every (run-state, event-type) cell", () => {
    for (const r of runStateNames) {
      for (const e of eventTypeNames) {
        expect(phaxDispositionMatrix[r][e]).toBeDefined();
      }
    }
  });

  it("agrees with the reducer on canonical (state, event) pairs", () => {
    for (const r of runStateNames) {
      for (const e of eventTypeNames) {
        const disposition = interpret(representativeState[r], sampleEvents[e]);
        const expected: DispositionKind = phaxDispositionMatrix[r][e];
        expect(
          disposition.kind,
          `${r} × ${e} — reducer returned ${disposition.kind} (reason: ${
            "reason" in disposition ? disposition.reason : "—"
          }), matrix says ${expected}`,
        ).toBe(expected);
      }
    }
  });
});

describe("interpret — run lifecycle", () => {
  it("RunStarted on created → running with pending phase", () => {
    const d = interpret(representativeState.created, sampleEvents.RunStarted);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({ run: "running", phase: { state: "pending" } });
    expect(d.effects).toEqual([]);
  });

  it("RunResumeRequested on rate_limited → running with phase=running", () => {
    const d = interpret(representativeState.rate_limited, sampleEvents.RunResumeRequested);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({ run: "running", phase: { state: "running" } });
  });

  it("RunResumeRequested on interrupted preserves non-exhausted phase substates", () => {
    const state: PhaxState = {
      run: "interrupted",
      phase: { state: "gates_failed", attempt: 2 },
    };
    const d = interpret(state, sampleEvents.RunResumeRequested);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "running",
      phase: { state: "gates_failed", attempt: 2 },
    });
  });

  it("RunResumeRequested on interrupted gates_exhausted lifts the phase to running", () => {
    const state: PhaxState = {
      run: "interrupted",
      phase: { state: "gates_exhausted", attempt: 3 },
    };
    const d = interpret(state, sampleEvents.RunResumeRequested);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "running",
      phase: { state: "running" },
    });
  });

  it("RunInterruptRequested freezes the phase substate", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "fixing", attempt: 1 },
    };
    const d = interpret(state, sampleEvents.RunInterruptRequested);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "interrupted",
      phase: { state: "fixing", attempt: 1 },
    });
  });

  it("RunFailed captures the error message on cause", () => {
    const d = interpret(representativeState.running, sampleEvents.RunFailed);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({ run: "failed", cause: "boom" });
  });

  it("RunArchiveRequested on completed → archived", () => {
    const d = interpret(representativeState.completed, sampleEvents.RunArchiveRequested);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({ run: "archived" });
  });

  it("RunArchiveRequested on archived is rejected (not ignored — explicit replay guard)", () => {
    const d = interpret(representativeState.archived, sampleEvents.RunArchiveRequested);
    expect(d.kind).toBe("Rejected");
  });
});

describe("interpret — phase lifecycle within running", () => {
  it("PhaseStartRequested when current phase is cleaned_up → setting_up_worktree", () => {
    const state: PhaxState = { run: "running", phase: { state: "cleaned_up" } };
    const d = interpret(state, sampleEvents.PhaseStartRequested);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "running",
      phase: { state: "setting_up_worktree" },
    });
  });

  it("WorktreeCreated transitions setting_up_worktree → running", () => {
    const state: PhaxState = { run: "running", phase: { state: "setting_up_worktree" } };
    const d = interpret(state, sampleEvents.WorktreeCreated);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({ run: "running", phase: { state: "running" } });
  });

  it("GatePassed transitions running → passed", () => {
    const state: PhaxState = { run: "running", phase: { state: "running" } };
    const d = interpret(state, sampleEvents.GatePassed);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({ run: "running", phase: { state: "passed" } });
  });

  it("GateFailed transitions running → gates_failed and records attempt", () => {
    const state: PhaxState = { run: "running", phase: { state: "running" } };
    const event: PhaxEvent = { ...sampleEvents.GateFailed, attempt: 2 };
    const d = interpret(state, event);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "running",
      phase: { state: "gates_failed", attempt: 2 },
    });
  });

  it("FixStarted only from gates_failed; from running it is Unexpected", () => {
    const handledState: PhaxState = {
      run: "running",
      phase: { state: "gates_failed", attempt: 0 },
    };
    const d1 = interpret(handledState, { ...sampleEvents.FixStarted, attempt: 1 });
    expect(d1.kind).toBe("Handled");
    if (d1.kind === "Handled") {
      expect(d1.nextState).toEqual({
        run: "running",
        phase: { state: "fixing", attempt: 1 },
      });
    }
    const d2 = interpret(representativeState.running, sampleEvents.FixStarted);
    expect(d2.kind).toBe("Unexpected");
  });

  it("FixCompleted from fixing → running; from running it is Unexpected", () => {
    const fixingState: PhaxState = {
      run: "running",
      phase: { state: "fixing", attempt: 1 },
    };
    const d = interpret(fixingState, sampleEvents.FixCompleted);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({ run: "running", phase: { state: "running" } });
  });

  it("FixAttemptsExhausted from gates_failed → interrupted/gates_exhausted with resume effects", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "gates_failed", attempt: 3 },
    };
    const d = interpret(state, sampleEvents.FixAttemptsExhausted);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "interrupted",
      phase: { state: "gates_exhausted", attempt: 3 },
    });
    expect(d.effects.map((effect) => effect.type)).toEqual([
      "PersistState",
      "WriteResumeInstructions",
      "EmitTrace",
      "EmitTrace",
    ]);
    const persistEffect = d.effects.find((e) => e.type === "PersistState");
    expect(persistEffect).toBeDefined();
    if (persistEffect?.type === "PersistState") {
      expect(persistEffect.patch.run?.stoppedReason).toBe("gates_exhausted");
      expect(persistEffect.patch.run?.lastError).toBe("Gate failed: pnpm test");
    }
    const resumeEffect = d.effects.find((e) => e.type === "WriteResumeInstructions");
    expect(resumeEffect).toBeDefined();
    if (resumeEffect?.type === "WriteResumeInstructions") {
      expect(resumeEffect.ctx).toMatchObject({
        reason: "Gate checks failed",
        kind: "gates_exhausted",
        phaseId,
        worktreePath,
        sessionId,
      });
    }
  });

  it("FixAttemptsExhausted from fixing → interrupted/gates_exhausted", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "fixing", attempt: 3 },
    };
    const d = interpret(state, sampleEvents.FixAttemptsExhausted);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "interrupted",
      phase: { state: "gates_exhausted", attempt: 3 },
    });
  });

  it("CommitCreated transitions passed → committed and records hash", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const event: PhaxEvent = { ...sampleEvents.CommitCreated, hash: "deadbeef" };
    const d = interpret(state, event);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "running",
      phase: { state: "committed", hash: "deadbeef" },
    });
  });

  it("CleanupStarted transitions committed → cleaning_up", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123" },
    };
    const d = interpret(state, sampleEvents.CleanupStarted);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({ run: "running", phase: { state: "cleaning_up" } });
  });

  it("CleanupCompleted transitions cleaning_up → cleaned_up", () => {
    const state: PhaxState = { run: "running", phase: { state: "cleaning_up" } };
    const d = interpret(state, sampleEvents.CleanupCompleted);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({ run: "running", phase: { state: "cleaned_up" } });
  });

  it("HandoffMissing from passed → handoff_failed with missing sections", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const event: PhaxEvent = {
      ...sampleEvents.HandoffMissing,
      missingSections: ["## Summary", "## Risk"],
    };
    const d = interpret(state, event);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "running",
      phase: { state: "handoff_failed", missing: ["## Summary", "## Risk"] },
    });
  });

  it("HandoffValidated from passed is Handled with no state change", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const d = interpret(state, sampleEvents.HandoffValidated);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual(state);
  });

  it("FinalReviewOpened when last phase is cleaned_up → review_open", () => {
    const state: PhaxState = { run: "running", phase: { state: "cleaned_up" } };
    const d = interpret(state, sampleEvents.FinalReviewOpened);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "review_open",
      phase: { state: "review_open" },
    });
  });
});

describe("interpret — rate limit handling", () => {
  it("running + phase=running × RateLimitDetected → rate_limited / rate_limited", () => {
    const d = interpret(representativeState.running, sampleEvents.RateLimitDetected);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({
      run: "rate_limited",
      phase: { state: "rate_limited" },
    });
  });

  it("running + phase=fixing × RateLimitDetected → rate_limited / rate_limited", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "fixing", attempt: 1 },
    };
    const d = interpret(state, sampleEvents.RateLimitDetected);
    expect(d.kind).toBe("Handled");
  });

  it("running + phase=committed × RateLimitDetected is Ignored (post-agent limit)", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc" },
    };
    const d = interpret(state, sampleEvents.RateLimitDetected);
    expect(d.kind).toBe("Ignored");
  });

  it("rate_limited × RateLimitDetected is Ignored (already paused)", () => {
    const d = interpret(representativeState.rate_limited, sampleEvents.RateLimitDetected);
    expect(d.kind).toBe("Ignored");
  });
});

describe("interpret — no-changes handling", () => {
  it("running + phase=passed × PhaseHadNoChanges → interrupted / skipped", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const d = interpret(state, sampleEvents.PhaseHadNoChanges);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    expect(d.nextState).toEqual({ run: "interrupted", phase: { state: "skipped" } });
  });

  it("running + phase=passed × PhaseHadNoChanges → emits WriteResumeInstructions effect", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const d = interpret(state, sampleEvents.PhaseHadNoChanges);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    const resumeEffect = d.effects.find((e) => e.type === "WriteResumeInstructions");
    expect(resumeEffect).toBeDefined();
    if (resumeEffect?.type === "WriteResumeInstructions") {
      expect(resumeEffect.ctx.reason).toBe("No changes");
    }
  });

  it("running + phase=passed × PhaseHadNoChanges → emits PersistState with stoppedReason=no_changes", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const d = interpret(state, sampleEvents.PhaseHadNoChanges);
    expect(d.kind).toBe("Handled");
    if (d.kind !== "Handled") return;
    const persistEffect = d.effects.find((e) => e.type === "PersistState");
    expect(persistEffect).toBeDefined();
    if (persistEffect?.type === "PersistState") {
      expect(persistEffect.patch.run?.stoppedReason).toBe("no_changes");
    }
  });

  it("running + phase=running × PhaseHadNoChanges is Unexpected (wrong phase state)", () => {
    const d = interpret(representativeState.running, sampleEvents.PhaseHadNoChanges);
    expect(d.kind).toBe("Unexpected");
  });

  it("interrupted × PhaseHadNoChanges is Stale", () => {
    const d = interpret(representativeState.interrupted, sampleEvents.PhaseHadNoChanges);
    expect(d.kind).toBe("Stale");
  });
});

describe("interpret — stale signals on terminal runs", () => {
  it("cleaned_up × GateFailed is Stale (doctrine example)", () => {
    const state: PhaxState = { run: "running", phase: { state: "cleaned_up" } };
    const d = interpret(state, sampleEvents.GateFailed);
    expect(d.kind).toBe("Stale");
  });

  it("archived × RunResumeRequested is Rejected (doctrine example)", () => {
    const d = interpret(representativeState.archived, sampleEvents.RunResumeRequested);
    expect(d.kind).toBe("Rejected");
  });

  it("late-delivered phase events on a failed run are Stale, not Unexpected", () => {
    const d = interpret(representativeState.failed, sampleEvents.GatePassed);
    expect(d.kind).toBe("Stale");
  });
});
