import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRunId } from "../../../src/domain/branded.js";
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
import {
  projectEvent,
  type SemanticTraceSnapshot,
} from "../../../src/domain/telemetry/snapshot.js";

const runId = Either.getOrThrow(decodeRunId("test-run-001"));

const ALLOWED_SNAPSHOT_KEYS = new Set([
  "type",
  "operationId",
  "event",
  "stateBefore",
  "stateAfter",
  "dispatcher",
  "adapter",
  "operation",
  "expected",
  "actual",
  "step",
  "gate",
  "reason",
  "artifact",
  "path",
  "result",
]);

const assertNoUnstableFields = (entry: object) => {
  for (const key of Object.keys(entry)) {
    expect(ALLOWED_SNAPSHOT_KEYS.has(key), `Unexpected key in snapshot: ${key}`).toBe(true);
  }
};

describe("projectEvent", () => {
  it("drops runId from state.transition", () => {
    const entry = projectEvent(
      makeStateTransitionTelemetryEvent({
        runId,
        event: "RUN_STARTED",
        stateBefore: "idle",
        stateAfter: "running",
        dispatcher: "dispatcher.ts",
      }),
    );
    expect("runId" in entry).toBe(false);
    assertNoUnstableFields(entry);
  });

  it("preserves semantic fields for state.transition", () => {
    const entry = projectEvent(
      makeStateTransitionTelemetryEvent({
        runId,
        operationId: "op-1",
        event: "RUN_STARTED",
        stateBefore: "idle",
        stateAfter: "running",
        dispatcher: "dispatcher.ts",
      }),
    );
    expect(entry).toMatchObject({
      type: "state.transition",
      operationId: "op-1",
      event: "RUN_STARTED",
      stateBefore: "idle",
      stateAfter: "running",
      dispatcher: "dispatcher.ts",
    });
  });

  it("preserves adapter and operation for adapter.call.started", () => {
    const entry = projectEvent(
      makeAdapterCallStartedTelemetryEvent({ runId, adapter: "git", operation: "worktree.create" }),
    );
    expect(entry).toMatchObject({
      type: "adapter.call.started",
      adapter: "git",
      operation: "worktree.create",
    });
    assertNoUnstableFields(entry);
  });

  it("preserves adapter and operation for adapter.call.succeeded", () => {
    const entry = projectEvent(
      makeAdapterCallSucceededTelemetryEvent({
        runId,
        adapter: "git",
        operation: "worktree.create",
      }),
    );
    expect(entry).toMatchObject({
      type: "adapter.call.succeeded",
      adapter: "git",
      operation: "worktree.create",
    });
    assertNoUnstableFields(entry);
  });

  it("drops exitCode and stderrExcerpt from adapter.call.failed", () => {
    const entry = projectEvent(
      makeAdapterCallFailedTelemetryEvent({
        runId,
        adapter: "shell",
        operation: "gate.typecheck",
        exitCode: 1,
        stderrExcerpt: "error TS2345",
      }),
    );
    expect("exitCode" in entry).toBe(false);
    expect("stderrExcerpt" in entry).toBe(false);
    assertNoUnstableFields(entry);
  });

  it("preserves optional expected/actual for adapter.call.failed", () => {
    const entry = projectEvent(
      makeAdapterCallFailedTelemetryEvent({
        runId,
        adapter: "shell",
        operation: "gate.typecheck",
        expected: "exit 0",
        actual: "exit 1",
        exitCode: 1,
        stderrExcerpt: "error TS2345",
      }),
    );
    expect(entry).toMatchObject({ expected: "exit 0", actual: "exit 1" });
  });

  it("preserves step for step.started", () => {
    const entry = projectEvent(makeStepStartedTelemetryEvent({ runId, step: "config.discover" }));
    expect(entry).toMatchObject({ type: "step.started", step: "config.discover" });
    assertNoUnstableFields(entry);
  });

  it("preserves step and result for step.completed", () => {
    const entry = projectEvent(
      makeStepCompletedTelemetryEvent({ runId, step: "config.discover", result: "success" }),
    );
    expect(entry).toMatchObject({
      type: "step.completed",
      step: "config.discover",
      result: "success",
    });
    assertNoUnstableFields(entry);
  });

  it("preserves gate and result for gate.evaluated", () => {
    const entry = projectEvent(
      makeGateEvaluatedTelemetryEvent({ runId, gate: "typecheck", result: "accepted" }),
    );
    expect(entry).toMatchObject({ type: "gate.evaluated", gate: "typecheck", result: "accepted" });
    assertNoUnstableFields(entry);
  });

  it("preserves optional reason for gate.evaluated", () => {
    const entry = projectEvent(
      makeGateEvaluatedTelemetryEvent({
        runId,
        gate: "lint",
        result: "rejected",
        reason: "lint errors",
      }),
    );
    expect(entry).toMatchObject({ reason: "lint errors" });
    assertNoUnstableFields(entry);
  });

  it("preserves artifact and path for artifact.generated", () => {
    const entry = projectEvent(
      makeArtifactGeneratedTelemetryEvent({
        runId,
        artifact: "claude-session-id",
        path: "/tmp/sid",
      }),
    );
    expect(entry).toMatchObject({
      type: "artifact.generated",
      artifact: "claude-session-id",
      path: "/tmp/sid",
    });
    assertNoUnstableFields(entry);
  });

  it("array of projected entries is assignable to SemanticTraceSnapshot", () => {
    const entries = [
      projectEvent(makeStepStartedTelemetryEvent({ runId, step: "config.discover" })),
    ];
    const snapshot: SemanticTraceSnapshot = entries;
    expect(snapshot).toHaveLength(1);
  });

  it("is a pure function — same input yields same output", () => {
    const event = makeStepStartedTelemetryEvent({ runId, step: "config.discover" });
    expect(projectEvent(event)).toEqual(projectEvent(event));
  });
});
