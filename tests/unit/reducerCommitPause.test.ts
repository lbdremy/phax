import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodePhaseId, decodeRunId } from "../../src/domain/branded.js";
import { interpret } from "../../src/domain/reducer.js";
import type { CommitFailed } from "../../src/domain/events.js";
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

const commitFailed: CommitFailed = {
  ...base,
  type: "CommitFailed",
  phaseId,
  worktreePath: "/tmp/worktrees/run-1/phase-01" as never,
  sessionId: "session-abc123" as never,
  reason: "pre-commit hook rejected staged files: oxfmt check failed",
};

describe("CommitFailed reducer — post-gate commit pause", () => {
  it("running + passed → interrupted + passed (pause transition, phase stays passed)", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const result = interpret(state, commitFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    expect(result.nextState).toEqual({
      run: "interrupted",
      phase: { state: "passed" },
    });
  });

  it("emits PersistState with stoppedReason commit_failed and lastError", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const result = interpret(state, commitFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    const persistState = result.effects.find((e) => e.type === "PersistState");
    expect(persistState).toBeDefined();
    if (persistState?.type !== "PersistState") return;
    expect(persistState.patch.run).toMatchObject({
      stoppedReason: "commit_failed",
      lastError: commitFailed.reason,
    });
  });

  it("emits WriteResumeInstructions with kind commit_failed", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const result = interpret(state, commitFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    const writeResume = result.effects.find((e) => e.type === "WriteResumeInstructions");
    expect(writeResume).toBeDefined();
    if (writeResume?.type !== "WriteResumeInstructions") return;
    expect(writeResume.ctx.kind).toBe("commit_failed");
    expect(writeResume.ctx.reason).toBe("Commit failed");
  });

  it("emits two EmitTrace effects (commit.failed and resume.available)", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const result = interpret(state, commitFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    const traces = result.effects.filter((e) => e.type === "EmitTrace");
    expect(traces.length).toBe(2);
    const names = traces.map((t) => (t.type === "EmitTrace" ? t.name : ""));
    expect(names).toContain("commit.failed");
    expect(names).toContain("resume.available");
  });

  it("running + running → Unexpected (commit failed while phase not passed)", () => {
    const state: PhaxState = { run: "running", phase: { state: "running" } };
    const result = interpret(state, commitFailed);
    expect(result.kind).toBe("Unexpected");
  });

  it("running + committed → Unexpected (commit already succeeded)", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123" },
    };
    const result = interpret(state, commitFailed);
    expect(result.kind).toBe("Unexpected");
  });

  it("interrupted + passed → Stale (event arrives on already-paused run)", () => {
    const state: PhaxState = { run: "interrupted", phase: { state: "passed" } };
    const result = interpret(state, commitFailed);
    expect(result.kind).toBe("Stale");
  });

  it("failed + (any) → Stale", () => {
    const state: PhaxState = { run: "failed", cause: "prior failure" };
    const result = interpret(state, commitFailed);
    expect(result.kind).toBe("Stale");
  });
});
