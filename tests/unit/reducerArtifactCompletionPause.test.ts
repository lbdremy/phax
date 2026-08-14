import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodePhaseId, decodeRunId } from "../../src/domain/branded.js";
import { interpret } from "../../src/domain/reducer.js";
import type { ArtifactCompletionFailed } from "../../src/domain/events.js";
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

const artifactCompletionFailed: ArtifactCompletionFailed = {
  ...base,
  type: "ArtifactCompletionFailed",
  phaseId,
  worktreePath: "/tmp/worktrees/run-1/phase-01" as never,
  reason: "InvalidArtifactTransitionError: Draft → Completed is not legal",
};

describe("ArtifactCompletionFailed reducer — post-commit completion pause", () => {
  it("running + committed → interrupted + committed", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123" },
    };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    expect(result.nextState).toEqual({
      run: "interrupted",
      phase: { state: "committed", hash: "abc123" },
    });
  });

  it("emits PersistState with stoppedReason artifact_completion_failed and lastError", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123" },
    };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    const persistState = result.effects.find((e) => e.type === "PersistState");
    expect(persistState).toBeDefined();
    if (persistState?.type !== "PersistState") return;
    expect(persistState.patch.run).toMatchObject({
      stoppedReason: "artifact_completion_failed",
      lastError: artifactCompletionFailed.reason,
    });
  });

  it("emits WriteResumeInstructions with kind artifact_completion_failed", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123" },
    };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    const writeResume = result.effects.find((e) => e.type === "WriteResumeInstructions");
    expect(writeResume).toBeDefined();
    if (writeResume?.type !== "WriteResumeInstructions") return;
    expect(writeResume.ctx.kind).toBe("artifact_completion_failed");
    expect(writeResume.ctx.reason).toBe("Artifact completion failed");
  });

  it("emits two EmitTrace effects (artifact.completion.failed and resume.available)", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123" },
    };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    const traces = result.effects.filter((e) => e.type === "EmitTrace");
    expect(traces.length).toBe(2);
    const names = traces.map((t) => (t.type === "EmitTrace" ? t.name : ""));
    expect(names).toContain("artifact.completion.failed");
    expect(names).toContain("resume.available");
  });

  it("running + passed → Unexpected (completion runs only after the commit)", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Unexpected");
  });

  it("running + cleaning_up → Unexpected (completion precedes cleanup)", () => {
    const state: PhaxState = { run: "running", phase: { state: "cleaning_up" } };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Unexpected");
  });

  it("rate_limited + (any) → Stale", () => {
    const state: PhaxState = { run: "rate_limited", phase: { state: "committed", hash: "x" } };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Stale");
  });

  it("interrupted + committed → Stale (event arrives on already-paused run)", () => {
    const state: PhaxState = { run: "interrupted", phase: { state: "committed", hash: "abc" } };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Stale");
  });

  it("failed + (any) → Stale", () => {
    const state: PhaxState = { run: "failed", cause: "prior failure" };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Stale");
  });

  it("review_open → Unexpected", () => {
    const state: PhaxState = { run: "review_open", phase: { state: "review_open" } };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Unexpected");
  });

  it("created → Unexpected", () => {
    const state: PhaxState = { run: "created" };
    const result = interpret(state, artifactCompletionFailed);
    expect(result.kind).toBe("Unexpected");
  });
});
