import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodePhaseId, decodeRunId } from "../../src/domain/branded.js";
import { interpret } from "../../src/domain/reducer.js";
import type { PhaxEvent, HandoffMissing } from "../../src/domain/events.js";
import type { PhaxState } from "../../src/domain/state.js";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const runId = unwrap(decodeRunId("run-1"));
const phaseId = unwrap(decodePhaseId("phase-01"));

const base = {
  eventId: "evt-1",
  occurredAt: "2026-05-20T12:00:00Z",
  run: runId,
  phase: phaseId,
} as const;

const handoffMissingEmpty: HandoffMissing = {
  ...base,
  type: "HandoffMissing",
  missingSections: [],
};

const handoffMissingWithSections: HandoffMissing = {
  ...base,
  type: "HandoffMissing",
  missingSections: ["## Summary", "## What the next phase needs to know"],
};

describe("HandoffMissing reducer — post-commit handoff pause", () => {
  it("running + committed → interrupted + handoff_failed (transient failure, empty missingSections)", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "abc123def456" },
    };
    const result = interpret(state, handoffMissingEmpty);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    expect(result.nextState).toEqual({
      run: "interrupted",
      phase: { state: "handoff_failed", missing: [] },
    });
  });

  it("running + committed → interrupted + handoff_failed (validation failure, sections captured)", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "committed", hash: "deadbeef" },
    };
    const result = interpret(state, handoffMissingWithSections);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    expect(result.nextState).toEqual({
      run: "interrupted",
      phase: {
        state: "handoff_failed",
        missing: ["## Summary", "## What the next phase needs to know"],
      },
    });
  });

  it("running + passed → running + handoff_failed (existing pre-commit path is unchanged)", () => {
    const state: PhaxState = { run: "running", phase: { state: "passed" } };
    const result = interpret(state, handoffMissingEmpty);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    expect(result.nextState).toEqual({
      run: "running",
      phase: { state: "handoff_failed", missing: [] },
    });
  });

  it("running + running → Unexpected (handoff while phase not in handoff-eligible state)", () => {
    const state: PhaxState = { run: "running", phase: { state: "running" } };
    const result = interpret(state, handoffMissingEmpty);
    expect(result.kind).toBe("Unexpected");
  });

  it("running + gates_failed → Unexpected", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "gates_failed", attempt: 1 },
    };
    const result = interpret(state, handoffMissingEmpty);
    expect(result.kind).toBe("Unexpected");
  });

  it("interrupted + handoff_failed → Stale (event arrives on already-paused run)", () => {
    const state: PhaxState = {
      run: "interrupted",
      phase: { state: "handoff_failed", missing: [] },
    };
    const result = interpret(state, handoffMissingEmpty);
    expect(result.kind).toBe("Stale");
  });
});
