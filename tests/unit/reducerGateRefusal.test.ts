import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodePhaseId, decodeRunId } from "../../src/domain/branded.js";
import type { GateStepRefused } from "../../src/domain/events.js";
import { phaxDispositionMatrix } from "../../src/domain/matrix.js";
import { interpret } from "../../src/domain/reducer.js";
import type { PhaxState } from "../../src/domain/state.js";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const runId = unwrap(decodeRunId("hello-world.greet"));
const phaseId = unwrap(decodePhaseId("phase-01"));

const refused: GateStepRefused = {
  eventId: "evt-1",
  occurredAt: "2026-10-09T12:00:00Z",
  run: runId,
  phase: phaseId,
  type: "GateStepRefused",
  attempt: 1,
  phaseId,
  worktreePath: "/tmp/worktrees/hello-world.greet/phase-01" as never,
  sessionId: "session-abc123" as never,
  command: "node ./audit.mjs",
  reason: "the checks need hw-rules 2, and 1 is installed",
  remedy: "pnpm add -D hw-rules@2",
};

const gatesFailed: PhaxState = { run: "running", phase: { state: "gates_failed", attempt: 1 } };

describe("GateStepRefused reducer — a refusal reuses the gate-failure pause", () => {
  it("running + gates_failed → interrupted + gates_exhausted", () => {
    const result = interpret(gatesFailed, refused);
    expect(result.kind).toBe("Handled");
    if (result.kind !== "Handled") return;
    expect(result.nextState).toEqual({
      run: "interrupted",
      phase: { state: "gates_exhausted", attempt: 1 },
    });
  });

  it("persists stoppedReason gates_exhausted and a lastError naming the step and the reason", () => {
    const result = interpret(gatesFailed, refused);
    if (result.kind !== "Handled") throw new Error(`expected Handled, got ${result.kind}`);
    const persist = result.effects.find((e) => e.type === "PersistState");
    if (persist?.type !== "PersistState") throw new Error("no PersistState");
    expect(persist.patch.run).toEqual({
      stoppedReason: "gates_exhausted",
      lastError:
        "Gate step refused: node ./audit.mjs — the checks need hw-rules 2, and 1 is installed",
    });
  });

  it("writes gate_refused resume instructions carrying the step, the reason and the remedy", () => {
    const result = interpret(gatesFailed, refused);
    if (result.kind !== "Handled") throw new Error(`expected Handled, got ${result.kind}`);
    const write = result.effects.find((e) => e.type === "WriteResumeInstructions");
    if (write?.type !== "WriteResumeInstructions") throw new Error("no WriteResumeInstructions");
    expect(write.ctx).toEqual({
      reason: "Gate step refused",
      kind: "gate_refused",
      phaseId: "phase-01",
      worktreePath: "/tmp/worktrees/hello-world.greet/phase-01",
      sessionId: "session-abc123",
      refusal: {
        command: "node ./audit.mjs",
        reason: "the checks need hw-rules 2, and 1 is installed",
        remedy: "pnpm add -D hw-rules@2",
      },
    });
  });

  it("emits the gate.refused and resume.available traces", () => {
    const result = interpret(gatesFailed, refused);
    if (result.kind !== "Handled") throw new Error(`expected Handled, got ${result.kind}`);
    const names = result.effects.flatMap((e) => (e.type === "EmitTrace" ? [e.name] : []));
    expect(names).toEqual(["gate.refused", "resume.available"]);
  });

  it("is unexpected from any other running phase state", () => {
    for (const phase of [
      { state: "running" },
      { state: "fixing", attempt: 1 },
      { state: "passed" },
    ] as const) {
      const result = interpret({ run: "running", phase }, refused);
      expect(result.kind, phase.state).toBe("Unexpected");
    }
  });

  it("is stale on a paused or ended run, and unexpected before or after the run", () => {
    expect(interpret({ run: "interrupted", phase: { state: "running" } }, refused).kind).toBe(
      "Stale",
    );
    expect(interpret({ run: "rate_limited", phase: { state: "rate_limited" } }, refused).kind).toBe(
      "Stale",
    );
    expect(interpret({ run: "failed", cause: "boom" }, refused).kind).toBe("Stale");
    expect(interpret({ run: "created" }, refused).kind).toBe("Unexpected");
    expect(interpret({ run: "review_open", phase: { state: "review_open" } }, refused).kind).toBe(
      "Unexpected",
    );
  });

  it("has a disposition in every run state of the matrix", () => {
    for (const row of Object.values(phaxDispositionMatrix)) {
      expect(row.GateStepRefused).toBeDefined();
    }
  });

  it("resuming the paused phase lifts it back to running", () => {
    const paused = interpret(gatesFailed, refused);
    if (paused.kind !== "Handled") throw new Error(`expected Handled, got ${paused.kind}`);
    const resumed = interpret(paused.nextState, {
      eventId: "evt-2",
      occurredAt: "2026-10-09T12:05:00Z",
      run: runId,
      type: "RunResumeRequested",
    });
    expect(resumed.kind).toBe("Handled");
    if (resumed.kind !== "Handled") return;
    expect(resumed.nextState).toEqual({ run: "running", phase: { state: "running" } });
  });
});
