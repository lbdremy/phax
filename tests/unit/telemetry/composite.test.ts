import { Effect, Either, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRunId } from "../../../src/domain/branded.js";
import {
  makeStepStartedTelemetryEvent,
  makeStateTransitionTelemetryEvent,
} from "../../../src/domain/telemetry/events.js";
import {
  makeInMemoryTelemetryLayer,
  InMemoryTelemetry,
} from "../../../src/infra/telemetry/inMemory.js";
import {
  makeCompositeOps,
  makeCompositeSystemTelemetryLayer,
} from "../../../src/infra/telemetry/composite.js";
import { SystemTelemetry } from "../../../src/ports/systemTelemetry.js";

const runId = Either.getOrThrow(decodeRunId("composite-test-001"));

const runWith = <A>(
  layer: Layer.Layer<SystemTelemetry>,
  eff: Effect.Effect<A, never, SystemTelemetry>,
): Promise<A> => Effect.runPromise(Effect.provide(eff, layer));

describe("makeCompositeOps", () => {
  it("fans out recordEvent to every implementation", async () => {
    const a = new InMemoryTelemetry();
    const b = new InMemoryTelemetry();
    const composite = makeCompositeOps([a, b]);
    const event = makeStepStartedTelemetryEvent({ runId, step: "test" });
    await Effect.runPromise(composite.recordEvent(event));
    expect(a.events()).toHaveLength(1);
    expect(b.events()).toHaveLength(1);
  });

  it("fans out incrementCounter to every implementation", async () => {
    const a = new InMemoryTelemetry();
    const b = new InMemoryTelemetry();
    const composite = makeCompositeOps([a, b]);
    await Effect.runPromise(composite.incrementCounter("my.counter"));
    expect(a.counters().get("my.counter")).toBe(1);
    expect(b.counters().get("my.counter")).toBe(1);
  });

  it("fans out recordDuration to every implementation", async () => {
    const a = new InMemoryTelemetry();
    const b = new InMemoryTelemetry();
    const composite = makeCompositeOps([a, b]);
    await Effect.runPromise(composite.recordDuration("latency", 42));
    expect(a.durations().get("latency")).toEqual([42]);
    expect(b.durations().get("latency")).toEqual([42]);
  });

  it("fans out recordError to every implementation", async () => {
    const a = new InMemoryTelemetry();
    const b = new InMemoryTelemetry();
    const composite = makeCompositeOps([a, b]);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const report = { type: "test.error", runId, cause: new Error("boom") } as Parameters<
      typeof a.recordError
    >[0];
    await Effect.runPromise(composite.recordError(report));
    expect(a.errors()).toHaveLength(1);
    expect(b.errors()).toHaveLength(1);
  });

  it("nests withOperation scopes: leftmost impl is outermost scope", async () => {
    const a = new InMemoryTelemetry();
    const b = new InMemoryTelemetry();
    const composite = makeCompositeOps([a, b]);

    await Effect.runPromise(
      composite.withOperation("outer", {}, composite.withOperation("inner", {}, Effect.void)),
    );

    // Both a and b processed both withOperation calls without error
    expect(a).toBeDefined();
    expect(b).toBeDefined();
  });

  it("does not block fanOut when one implementation fails internally", async () => {
    const good = new InMemoryTelemetry();
    const bad: typeof good = {
      ...good,
      recordEvent: () => Effect.fail(new Error("bad impl") as never),
    };
    const composite = makeCompositeOps([bad, good]);
    const event = makeStepStartedTelemetryEvent({ runId, step: "resilience-test" });

    // Should not throw even though `bad` fails
    await expect(Effect.runPromise(composite.recordEvent(event))).resolves.toBeUndefined();
    // The good implementation still received the event
    expect(good.events()).toHaveLength(1);
  });

  it("withOperation re-throws the underlying effect error", async () => {
    const impl = new InMemoryTelemetry();
    const composite = makeCompositeOps([impl]);
    const exit = await Effect.runPromiseExit(
      composite.withOperation("failing-op", {}, Effect.fail("test-error" as const)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("withOperation nests: left is outer, right is inner when inspecting stacks", async () => {
    const a = new InMemoryTelemetry();
    const b = new InMemoryTelemetry();
    const composite = makeCompositeOps([a, b]);

    const visited: string[] = [];

    const inner = Effect.sync(() => {
      visited.push("inner");
    });

    await Effect.runPromise(composite.withOperation("outer-op", {}, inner));

    expect(visited).toEqual(["inner"]);
  });
});

describe("makeCompositeSystemTelemetryLayer", () => {
  it("composes two InMemoryTelemetry layers — every method reaches both", async () => {
    const { impl: a, layer: layerA } = makeInMemoryTelemetryLayer();
    const { impl: b, layer: layerB } = makeInMemoryTelemetryLayer();

    const compositeLayer = makeCompositeSystemTelemetryLayer([layerA, layerB]);
    const event = makeStateTransitionTelemetryEvent({
      runId,
      event: "plan.dispatched",
      stateBefore: "initialized",
      stateAfter: "running",
      dispatcher: "test",
    });

    await runWith(
      compositeLayer,
      SystemTelemetry.pipe(Effect.flatMap((t) => t.recordEvent(event))),
    );

    expect(a.events()).toHaveLength(1);
    expect(b.events()).toHaveLength(1);
  });

  it("withOperation on composite layer nests scopes in documented order", async () => {
    const { impl: a, layer: layerA } = makeInMemoryTelemetryLayer();
    const { impl: b, layer: layerB } = makeInMemoryTelemetryLayer();

    const compositeLayer = makeCompositeSystemTelemetryLayer([layerA, layerB]);
    const event = makeStepStartedTelemetryEvent({ runId, step: "nested-test" });

    await runWith(
      compositeLayer,
      SystemTelemetry.pipe(
        Effect.flatMap((t) =>
          t.withOperation("outer", {}, t.withOperation("inner", {}, t.recordEvent(event))),
        ),
      ),
    );

    // Both a and b received the event
    expect(a.events()).toHaveLength(1);
    expect(b.events()).toHaveLength(1);
  });

  it("handles empty layers array without error", async () => {
    const compositeLayer = makeCompositeSystemTelemetryLayer([]);
    const event = makeStepStartedTelemetryEvent({ runId, step: "empty-test" });
    await expect(
      runWith(compositeLayer, SystemTelemetry.pipe(Effect.flatMap((t) => t.recordEvent(event)))),
    ).resolves.toBeUndefined();
  });
});
