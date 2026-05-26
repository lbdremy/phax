import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { decodeRunId } from "../../../src/domain/branded.js";
import {
  makeStateTransitionTelemetryEvent,
  makeStepStartedTelemetryEvent,
} from "../../../src/domain/telemetry/events.js";
import { makeSystemErrorReport } from "../../../src/domain/telemetry/errors.js";
import { NoopSystemTelemetryLayer, SystemTelemetry } from "../../../src/ports/systemTelemetry.js";

const runId = Either.getOrThrow(decodeRunId("test-run-001"));

const runNoop = <A>(eff: Effect.Effect<A, never, SystemTelemetry>): Promise<A> =>
  Effect.runPromise(Effect.provide(eff, NoopSystemTelemetryLayer));

describe("NoopSystemTelemetryLayer", () => {
  it("recordEvent returns void", async () => {
    const event = makeStepStartedTelemetryEvent({ runId, step: "config.discover" });
    const result = await runNoop(SystemTelemetry.pipe(Effect.flatMap((t) => t.recordEvent(event))));
    expect(result).toBeUndefined();
  });

  it("recordTransition returns void", async () => {
    const transition = makeStateTransitionTelemetryEvent({
      runId,
      event: "RUN_STARTED",
      stateBefore: "idle",
      stateAfter: "running",
      dispatcher: "dispatcher.ts",
    });
    const result = await runNoop(
      SystemTelemetry.pipe(Effect.flatMap((t) => t.recordTransition(transition))),
    );
    expect(result).toBeUndefined();
  });

  it("recordError returns void", async () => {
    const report = makeSystemErrorReport({
      type: "adapter.command_failed",
      runId,
      cause: new Error("test"),
    });
    const result = await runNoop(
      SystemTelemetry.pipe(Effect.flatMap((t) => t.recordError(report))),
    );
    expect(result).toBeUndefined();
  });

  it("incrementCounter returns void", async () => {
    const result = await runNoop(
      SystemTelemetry.pipe(Effect.flatMap((t) => t.incrementCounter("my.counter"))),
    );
    expect(result).toBeUndefined();
  });

  it("recordDuration returns void", async () => {
    const result = await runNoop(
      SystemTelemetry.pipe(Effect.flatMap((t) => t.recordDuration("my.duration", 42))),
    );
    expect(result).toBeUndefined();
  });

  it("withOperation passes through success value unchanged", async () => {
    const result = await runNoop(
      SystemTelemetry.pipe(
        Effect.flatMap((t) => t.withOperation("test.op", {}, Effect.succeed(99))),
      ),
    );
    expect(result).toBe(99);
  });

  it("withOperation re-throws errors unchanged", async () => {
    class TestError {
      readonly _tag = "TestError";
    }
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        SystemTelemetry.pipe(
          Effect.flatMap((t) => t.withOperation("test.op", {}, Effect.fail(new TestError()))),
        ),
        NoopSystemTelemetryLayer,
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const cause = exit.cause;
      expect(JSON.stringify(cause)).toContain("TestError");
    }
  });
});
