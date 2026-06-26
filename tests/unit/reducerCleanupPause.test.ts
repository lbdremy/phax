import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodePhaseId, decodeRunId } from "../../src/domain/branded.js";
import { interpret } from "../../src/domain/reducer.js";
import type { CleanupFailed } from "../../src/domain/events.js";
import type { PhaxState } from "../../src/domain/state.js";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const runId = unwrap(decodeRunId("run-1"));
const phaseId = unwrap(decodePhaseId("phase-01"));

const base = {
  eventId: "evt-1",
  occurredAt: "2026-06-26T12:00:00Z",
  run: runId,
  phase: phaseId,
} as const;

const cleanupFailed: CleanupFailed = {
  ...base,
  type: "CleanupFailed",
  phaseId,
  worktreePath: "/tmp/worktrees/run-1/phase-01" as never,
  reason: "worktree removal failed: git worktree remove exited 1",
};

describe("CleanupFailed reducer — post-commit cleanup pause", () => {
  it("running + committed → interrupted + cleaning_up", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123" },
    };
    const result = interpret(state, cleanupFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    expect(result.nextState).toEqual({
      run: "interrupted",
      phase: { state: "cleaning_up" },
    });
  });

  it("running + cleaning_up → interrupted + cleaning_up (idempotent: dirty-worktree guard failed before CleanupStarted)", () => {
    const state: PhaxState = { run: "running", phase: { state: "cleaning_up" } };
    const result = interpret(state, cleanupFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    expect(result.nextState).toEqual({
      run: "interrupted",
      phase: { state: "cleaning_up" },
    });
  });

  it("emits PersistState with stoppedReason cleanup_failed and lastError", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123" },
    };
    const result = interpret(state, cleanupFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    const persistState = result.effects.find((e) => e.type === "PersistState");
    expect(persistState).toBeDefined();
    if (persistState?.type !== "PersistState") return;
    expect(persistState.patch.run).toMatchObject({
      stoppedReason: "cleanup_failed",
      lastError: cleanupFailed.reason,
    });
  });

  it("emits WriteResumeInstructions with kind cleanup_failed", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123" },
    };
    const result = interpret(state, cleanupFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    const writeResume = result.effects.find((e) => e.type === "WriteResumeInstructions");
    expect(writeResume).toBeDefined();
    if (writeResume?.type !== "WriteResumeInstructions") return;
    expect(writeResume.ctx.kind).toBe("cleanup_failed");
    expect(writeResume.ctx.reason).toBe("Cleanup failed");
  });

  it("emits two EmitTrace effects (cleanup.failed and resume.available)", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123" },
    };
    const result = interpret(state, cleanupFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    const traces = result.effects.filter((e) => e.type === "EmitTrace");
    expect(traces.length).toBe(2);
    const names = traces.map((t) => (t.type === "EmitTrace" ? t.name : ""));
    expect(names).toContain("cleanup.failed");
    expect(names).toContain("resume.available");
  });

  it("running + passed → Unexpected (cleanup failed before the commit)", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const result = interpret(state, cleanupFailed);
    expect(result.kind).toBe("Unexpected");
  });

  it("running + running → Unexpected (cleanup not yet started)", () => {
    const state: PhaxState = { run: "running", phase: { state: "running" } };
    const result = interpret(state, cleanupFailed);
    expect(result.kind).toBe("Unexpected");
  });

  it("interrupted + cleaning_up → Stale (event arrives on already-paused run)", () => {
    const state: PhaxState = { run: "interrupted", phase: { state: "cleaning_up" } };
    const result = interpret(state, cleanupFailed);
    expect(result.kind).toBe("Stale");
  });

  it("failed + (any) → Stale", () => {
    const state: PhaxState = { run: "failed", cause: "prior failure" };
    const result = interpret(state, cleanupFailed);
    expect(result.kind).toBe("Stale");
  });
});

describe("CleanupStarted idempotency on resume-from-cleanup", () => {
  it("running + cleaning_up → Handled (stays cleaning_up, idempotent)", () => {
    const state: PhaxState = { run: "running", phase: { state: "cleaning_up" } };
    const event = { ...base, type: "CleanupStarted" as const };
    const result = interpret(state, event);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    expect(result.nextState).toEqual({ run: "running", phase: { state: "cleaning_up" } });
  });
});
