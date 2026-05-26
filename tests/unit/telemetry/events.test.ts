import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  makeAdapterCallFailedTelemetryEvent,
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeArtifactGeneratedTelemetryEvent,
  makeGateEvaluatedTelemetryEvent,
  makeStateTransitionTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeStepStartedTelemetryEvent,
} from "../../../src/domain/telemetry/events.js";
import { decodeRunId } from "../../../src/domain/branded.js";
import { decodeSemanticTelemetryEvent } from "../../../src/schemas/telemetryEvents.js";

const runId = Either.getOrThrow(decodeRunId("test-run-001"));

describe("makeStateTransitionTelemetryEvent", () => {
  it("produces a value the schema accepts", () => {
    const event = makeStateTransitionTelemetryEvent({
      runId,
      event: "RUN_STARTED",
      stateBefore: "idle",
      stateAfter: "running",
      dispatcher: "dispatcher.ts",
    });
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });

  it("sets type to state.transition", () => {
    const event = makeStateTransitionTelemetryEvent({
      runId,
      event: "RUN_STARTED",
      stateBefore: "idle",
      stateAfter: "running",
      dispatcher: "dispatcher.ts",
    });
    expect(event.type).toBe("state.transition");
  });

  it("preserves optional operationId when provided", () => {
    const event = makeStateTransitionTelemetryEvent({
      runId,
      operationId: "op-123",
      event: "RUN_STARTED",
      stateBefore: "idle",
      stateAfter: "running",
      dispatcher: "dispatcher.ts",
    });
    expect(event.operationId).toBe("op-123");
  });
});

describe("makeAdapterCallStartedTelemetryEvent", () => {
  it("produces a value the schema accepts", () => {
    const event = makeAdapterCallStartedTelemetryEvent({
      runId,
      adapter: "git",
      operation: "worktree.create",
    });
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });

  it("sets type to adapter.call.started", () => {
    const event = makeAdapterCallStartedTelemetryEvent({
      runId,
      adapter: "git",
      operation: "worktree.create",
    });
    expect(event.type).toBe("adapter.call.started");
  });
});

describe("makeAdapterCallSucceededTelemetryEvent", () => {
  it("produces a value the schema accepts", () => {
    const event = makeAdapterCallSucceededTelemetryEvent({
      runId,
      adapter: "git",
      operation: "worktree.create",
    });
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });
});

describe("makeAdapterCallFailedTelemetryEvent", () => {
  it("produces a value the schema accepts", () => {
    const event = makeAdapterCallFailedTelemetryEvent({
      runId,
      adapter: "shell",
      operation: "gate.typecheck",
      exitCode: 1,
      stderrExcerpt: "error TS2345",
    });
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });

  it("includes optional expected and actual when provided", () => {
    const event = makeAdapterCallFailedTelemetryEvent({
      runId,
      adapter: "shell",
      operation: "gate.typecheck",
      expected: "exit 0",
      actual: "exit 1",
      exitCode: 1,
      stderrExcerpt: "error TS2345",
    });
    expect(event.expected).toBe("exit 0");
    expect(event.actual).toBe("exit 1");
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });
});

describe("makeStepStartedTelemetryEvent", () => {
  it("produces a value the schema accepts", () => {
    const event = makeStepStartedTelemetryEvent({ runId, step: "config.discover" });
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
    expect(event.type).toBe("step.started");
  });
});

describe("makeStepCompletedTelemetryEvent", () => {
  it("produces a value the schema accepts for success", () => {
    const event = makeStepCompletedTelemetryEvent({
      runId,
      step: "config.discover",
      result: "success",
    });
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });

  it("produces a value the schema accepts for failure", () => {
    const event = makeStepCompletedTelemetryEvent({
      runId,
      step: "config.discover",
      result: "failure",
    });
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });
});

describe("makeGateEvaluatedTelemetryEvent", () => {
  it("produces a value the schema accepts", () => {
    const event = makeGateEvaluatedTelemetryEvent({
      runId,
      gate: "typecheck",
      result: "accepted",
    });
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });

  it("includes optional reason when provided", () => {
    const event = makeGateEvaluatedTelemetryEvent({
      runId,
      gate: "typecheck",
      result: "rejected",
      reason: "type errors found",
    });
    expect(event.reason).toBe("type errors found");
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });
});

describe("makeArtifactGeneratedTelemetryEvent", () => {
  it("produces a value the schema accepts", () => {
    const event = makeArtifactGeneratedTelemetryEvent({
      runId,
      artifact: "claude-session-id",
      path: "/tmp/session.txt",
    });
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
    expect(event.type).toBe("artifact.generated");
  });
});

describe("schema rejection", () => {
  it("rejects an unknown event type", () => {
    expect(Either.isLeft(decodeSemanticTelemetryEvent({ type: "unknown.event", runId }))).toBe(
      true,
    );
  });

  it("rejects missing required field", () => {
    expect(Either.isLeft(decodeSemanticTelemetryEvent({ type: "step.started", runId }))).toBe(true);
  });
});
