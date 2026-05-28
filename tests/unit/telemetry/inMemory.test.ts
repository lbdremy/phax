import { Effect, Either, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRunId } from "../../../src/domain/branded.js";
import {
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeStateTransitionTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeStepStartedTelemetryEvent,
} from "../../../src/domain/telemetry/events.js";
import { makeSystemErrorReport } from "../../../src/domain/telemetry/errors.js";
import {
  InMemoryTelemetry,
  makeInMemoryTelemetryLayer,
} from "../../../src/infra/telemetry/inMemory.js";
import { SystemTelemetry } from "../../../src/ports/systemTelemetry.js";

const runId = Either.getOrThrow(decodeRunId("test-run-001"));

const runWith = <A>(
  layer: Layer.Layer<SystemTelemetry>,
  eff: Effect.Effect<A, never, SystemTelemetry>,
): Promise<A> => Effect.runPromise(Effect.provide(eff, layer));

describe("InMemoryTelemetry", () => {
  describe("events()", () => {
    it("stores events in insertion order", async () => {
      const { impl, layer } = makeInMemoryTelemetryLayer();
      const e1 = makeStepStartedTelemetryEvent({ runId, step: "config.discover" });
      const e2 = makeStepCompletedTelemetryEvent({
        runId,
        step: "config.discover",
        result: "success",
      });
      await runWith(
        layer,
        SystemTelemetry.pipe(
          Effect.flatMap((t) =>
            Effect.all([t.recordEvent(e1), t.recordEvent(e2)], { concurrency: "sequential" }),
          ),
        ),
      );
      expect(impl.events()).toEqual([e1, e2]);
    });

    it("returns empty array initially", () => {
      const { impl } = makeInMemoryTelemetryLayer();
      expect(impl.events()).toHaveLength(0);
    });
  });

  describe("recordTransition()", () => {
    it("is an alias for recordEvent of the transition variant", async () => {
      const { impl, layer } = makeInMemoryTelemetryLayer();
      const transition = makeStateTransitionTelemetryEvent({
        runId,
        event: "RUN_STARTED",
        stateBefore: "idle",
        stateAfter: "running",
        dispatcher: "dispatcher.ts",
      });
      await runWith(
        layer,
        SystemTelemetry.pipe(Effect.flatMap((t) => t.recordTransition(transition))),
      );
      expect(impl.events()).toEqual([transition]);
    });
  });

  describe("recordError()", () => {
    it("appends to the errors list", async () => {
      const { impl, layer } = makeInMemoryTelemetryLayer();
      const report = makeSystemErrorReport({
        type: "adapter.command_failed",
        runId,
        cause: new Error("test"),
      });
      await runWith(layer, SystemTelemetry.pipe(Effect.flatMap((t) => t.recordError(report))));
      expect(impl.errors()).toHaveLength(1);
      expect(impl.errors()[0]).toBe(report);
    });
  });

  describe("withOperation()", () => {
    it("passes through the success value unchanged", async () => {
      const { layer } = makeInMemoryTelemetryLayer();
      const result = await runWith(
        layer,
        SystemTelemetry.pipe(
          Effect.flatMap((t) => t.withOperation("test.op", {}, Effect.succeed(42))),
        ),
      );
      expect(result).toBe(42);
    });

    it("re-throws error unchanged on failure", async () => {
      class TestError {
        readonly _tag = "TestError";
      }
      const { layer } = makeInMemoryTelemetryLayer();
      const exit = await Effect.runPromiseExit(
        Effect.provide(
          SystemTelemetry.pipe(
            Effect.flatMap((t) => t.withOperation("test.op", {}, Effect.fail(new TestError()))),
          ),
          layer,
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("TestError");
      }
    });

    it("still records surrounding events even when operation fails", async () => {
      const { impl, layer } = makeInMemoryTelemetryLayer();
      const e1 = makeStepStartedTelemetryEvent({ runId, step: "pre" });
      const e2 = makeStepStartedTelemetryEvent({ runId, step: "post" });
      class Boom {
        readonly _tag = "Boom";
      }

      const exit = await Effect.runPromiseExit(
        Effect.provide(
          SystemTelemetry.pipe(
            Effect.flatMap((t) =>
              Effect.all([t.recordEvent(e1), t.withOperation("op", {}, Effect.fail(new Boom()))], {
                concurrency: "sequential",
              }),
            ),
          ),
          layer,
        ),
      );
      // The operation fails so e2 is never recorded, but e1 was
      expect(Exit.isFailure(exit)).toBe(true);
      expect(impl.events()).toEqual([e1]);
    });
  });

  describe("incrementCounter()", () => {
    it("sums across multiple calls with the same name", async () => {
      const { impl, layer } = makeInMemoryTelemetryLayer();
      await runWith(
        layer,
        SystemTelemetry.pipe(
          Effect.flatMap((t) =>
            Effect.all(
              [
                t.incrementCounter("my.counter"),
                t.incrementCounter("my.counter"),
                t.incrementCounter("my.counter"),
              ],
              { concurrency: "sequential" },
            ),
          ),
        ),
      );
      expect(impl.counters().get("my.counter")).toBe(3);
    });

    it("keys separately for different attribute sets", async () => {
      const { impl, layer } = makeInMemoryTelemetryLayer();
      await runWith(
        layer,
        SystemTelemetry.pipe(
          Effect.flatMap((t) =>
            Effect.all(
              [
                t.incrementCounter("my.counter", { env: "prod" }),
                t.incrementCounter("my.counter", { env: "dev" }),
                t.incrementCounter("my.counter", { env: "prod" }),
              ],
              { concurrency: "sequential" },
            ),
          ),
        ),
      );
      expect(impl.counters().get('my.counter:{"env":"prod"}')).toBe(2);
      expect(impl.counters().get('my.counter:{"env":"dev"}')).toBe(1);
    });
  });

  describe("recordDuration()", () => {
    it("preserves sample order", async () => {
      const { impl, layer } = makeInMemoryTelemetryLayer();
      await runWith(
        layer,
        SystemTelemetry.pipe(
          Effect.flatMap((t) =>
            Effect.all(
              [
                t.recordDuration("op.latency", 10),
                t.recordDuration("op.latency", 25),
                t.recordDuration("op.latency", 5),
              ],
              { concurrency: "sequential" },
            ),
          ),
        ),
      );
      expect(impl.durations().get("op.latency")).toEqual([10, 25, 5]);
    });
  });

  describe("getSemanticTraceSnapshot()", () => {
    it("returns only doctrine §7 fields — no runId, operationId stripped when absent", async () => {
      const { impl, layer } = makeInMemoryTelemetryLayer();
      const event = makeAdapterCallStartedTelemetryEvent({
        runId,
        adapter: "git",
        operation: "worktree.create",
      });
      await runWith(layer, SystemTelemetry.pipe(Effect.flatMap((t) => t.recordEvent(event))));
      const snapshot = impl.getSemanticTraceSnapshot();
      expect(snapshot).toHaveLength(1);
      const entry = snapshot[0]!;

      // Allowed projection fields only
      const allowedKeys = new Set([
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
      for (const key of Object.keys(entry)) {
        expect(allowedKeys.has(key), `Unexpected key in snapshot: ${key}`).toBe(true);
      }

      // runId must NOT be present
      expect(Object.keys(entry)).not.toContain("runId");
    });

    it("maps events through projectEvent deterministically", async () => {
      const { impl, layer } = makeInMemoryTelemetryLayer();
      const transition = makeStateTransitionTelemetryEvent({
        runId,
        event: "RUN_STARTED",
        stateBefore: "idle",
        stateAfter: "running",
        dispatcher: "dispatcher.ts",
      });
      await runWith(
        layer,
        SystemTelemetry.pipe(Effect.flatMap((t) => t.recordTransition(transition))),
      );
      const snapshot = impl.getSemanticTraceSnapshot();
      expect(snapshot[0]).toEqual({
        type: "state.transition",
        event: "RUN_STARTED",
        stateBefore: "idle",
        stateAfter: "running",
        dispatcher: "dispatcher.ts",
      });
    });
  });
});

describe("makeFakeSystemTelemetry (via InMemoryTelemetry)", () => {
  it("impl and layer are returned together", () => {
    const { impl, layer } = makeInMemoryTelemetryLayer();
    expect(impl).toBeInstanceOf(InMemoryTelemetry);
    expect(layer).toBeDefined();
  });
});
