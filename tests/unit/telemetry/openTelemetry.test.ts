import { Effect, Either, Exit } from "effect";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SpanStatusCode } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeRunId } from "../../../src/domain/branded.js";
import { makeAdapterCallStartedTelemetryEvent } from "../../../src/domain/telemetry/events.js";
import { makeSystemErrorReport } from "../../../src/domain/telemetry/errors.js";
import {
  makeOpenTelemetrySystemTelemetryLayer,
  makeOpenTelemetrySystemTelemetryOps,
  type OpenTelemetryAdapterOptions,
} from "../../../src/infra/telemetry/openTelemetry.js";
import { SystemTelemetry, type SystemTelemetryOps } from "../../../src/ports/systemTelemetry.js";

const runId = Either.getOrThrow(decodeRunId("otel-run-001"));

interface Harness {
  ops: SystemTelemetryOps;
  spanExporter: InMemorySpanExporter;
  metricExporter: InMemoryMetricExporter;
  metricReader: PeriodicExportingMetricReader;
  tracerProvider: BasicTracerProvider;
  meterProvider: MeterProvider;
}

const buildHarness = (): Harness => {
  const resource = resourceFromAttributes({ "service.name": "phax-test" });
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
    exportTimeoutMillis: 5_000,
  });
  const meterProvider = new MeterProvider({ resource, readers: [metricReader] });
  const tracer = tracerProvider.getTracer("phax-test");
  const meter = meterProvider.getMeter("phax-test");
  return {
    ops: makeOpenTelemetrySystemTelemetryOps(tracer, meter),
    spanExporter,
    metricExporter,
    metricReader,
    tracerProvider,
    meterProvider,
  };
};

let harness: Harness;

beforeEach(() => {
  harness = buildHarness();
});

afterEach(async () => {
  await harness.tracerProvider.shutdown();
  await harness.meterProvider.shutdown();
});

const findSpan = (spans: ReadonlyArray<ReadableSpan>, name: string): ReadableSpan => {
  const found = spans.find((s) => s.name === name);
  if (found === undefined) {
    throw new Error(`Span "${name}" not found; got [${spans.map((s) => s.name).join(", ")}]`);
  }
  return found;
};

describe("OpenTelemetrySystemTelemetry — withOperation", () => {
  it("produces a single span with the supplied attributes including phax.run.id", async () => {
    await Effect.runPromise(
      harness.ops.withOperation("phax.git.worktree.create", { "phax.run.id": runId }, Effect.void),
    );

    const spans = harness.spanExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.name).toBe("phax.git.worktree.create");
    expect(span.attributes["phax.run.id"]).toBe(runId);
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("nests inner withOperation as a child span of the outer one", async () => {
    await Effect.runPromise(
      harness.ops.withOperation(
        "outer",
        { "phax.run.id": runId },
        harness.ops.withOperation("inner", { "phax.run.id": runId }, Effect.void),
      ),
    );

    const spans = harness.spanExporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    const outer = findSpan(spans, "outer");
    const inner = findSpan(spans, "inner");
    expect(inner.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
    expect(inner.spanContext().traceId).toBe(outer.spanContext().traceId);
  });

  it("sets span status to ERROR and records the exception on failure", async () => {
    class Boom extends Error {
      override readonly name = "Boom";
    }
    const exit = await Effect.runPromiseExit(
      harness.ops.withOperation(
        "failing.op",
        { "phax.run.id": runId },
        Effect.fail(new Boom("kaboom")),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);

    const spans = harness.spanExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    const exceptionEvent = span.events.find((e) => e.name === "exception");
    expect(exceptionEvent).toBeDefined();
    expect(exceptionEvent?.attributes?.["exception.message"]).toBe("kaboom");
  });

  it("propagates the success value of the wrapped effect unchanged", async () => {
    const result = await Effect.runPromise(
      harness.ops.withOperation("pass-through", { "phax.run.id": runId }, Effect.succeed(42)),
    );
    expect(result).toBe(42);
  });
});

describe("OpenTelemetrySystemTelemetry — recordEvent / recordTransition", () => {
  it("adds a span event whose name matches the event type", async () => {
    const event = makeAdapterCallStartedTelemetryEvent({
      runId,
      adapter: "git",
      operation: "worktree.create",
    });
    await Effect.runPromise(
      harness.ops.withOperation("outer", { "phax.run.id": runId }, harness.ops.recordEvent(event)),
    );

    const spans = harness.spanExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.events).toHaveLength(1);
    const evt = span.events[0]!;
    expect(evt.name).toBe("adapter.call.started");
    expect(evt.attributes?.adapter).toBe("git");
    expect(evt.attributes?.operation).toBe("worktree.create");
    expect(evt.attributes?.runId).toBe(runId);
  });

  it("silently drops events when no operation is active", async () => {
    const event = makeAdapterCallStartedTelemetryEvent({
      runId,
      adapter: "git",
      operation: "worktree.create",
    });
    await Effect.runPromise(harness.ops.recordEvent(event));
    expect(harness.spanExporter.getFinishedSpans()).toHaveLength(0);
  });
});

describe("OpenTelemetrySystemTelemetry — recordError", () => {
  it("emits an error event, sets span status to ERROR, and records the exception", async () => {
    const cause = new Error("git failed");
    const report = makeSystemErrorReport({
      type: "adapter.command_failed",
      runId,
      adapter: "git",
      operation: "worktree.create",
      exitCode: 128,
      stderrExcerpt: "fatal: ...",
      cause,
    });

    await Effect.runPromise(
      harness.ops.withOperation("outer", { "phax.run.id": runId }, harness.ops.recordError(report)),
    );

    const spans = harness.spanExporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    const errorEvent = span.events.find((e) => e.name === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.attributes?.type).toBe("adapter.command_failed");
    expect(errorEvent?.attributes?.adapter).toBe("git");
    expect(errorEvent?.attributes?.exitCode).toBe(128);
    const exceptionEvent = span.events.find((e) => e.name === "exception");
    expect(exceptionEvent?.attributes?.["exception.message"]).toBe("git failed");
  });
});

describe("OpenTelemetrySystemTelemetry — metrics", () => {
  it("increments a counter and exports the cumulative value", async () => {
    await Effect.runPromise(
      Effect.all(
        [
          harness.ops.incrementCounter("phax.event.handled"),
          harness.ops.incrementCounter("phax.event.handled"),
          harness.ops.incrementCounter("phax.event.handled"),
        ],
        { concurrency: "sequential" },
      ),
    );

    const result = await harness.metricReader.collect();
    const allPoints = result.resourceMetrics.scopeMetrics.flatMap((sm) => sm.metrics);
    const counter = allPoints.find((m) => m.descriptor.name === "phax.event.handled");
    expect(counter).toBeDefined();
    expect(counter?.dataPointType).toBe(DataPointType.SUM);
    const sample = counter?.dataPoints[0];
    expect(sample?.value).toBe(3);
  });

  it("records duration samples into a histogram", async () => {
    await Effect.runPromise(
      Effect.all(
        [
          harness.ops.recordDuration("phax.op.duration_ms", 10),
          harness.ops.recordDuration("phax.op.duration_ms", 25),
          harness.ops.recordDuration("phax.op.duration_ms", 5),
        ],
        { concurrency: "sequential" },
      ),
    );

    const result = await harness.metricReader.collect();
    const allPoints = result.resourceMetrics.scopeMetrics.flatMap((sm) => sm.metrics);
    const histogram = allPoints.find((m) => m.descriptor.name === "phax.op.duration_ms");
    expect(histogram).toBeDefined();
    expect(histogram?.dataPointType).toBe(DataPointType.HISTOGRAM);
    const sample = histogram?.dataPoints[0];
    expect(sample?.value.count).toBe(3);
    expect(sample?.value.sum).toBe(40);
  });
});

describe("makeOpenTelemetrySystemTelemetryLayer", () => {
  it("builds a SystemTelemetry layer that runs withOperation successfully", async () => {
    const opts: OpenTelemetryAdapterOptions = {
      tracerName: "phax-test",
      meterName: "phax-test",
      resourceAttributes: { "service.name": "phax-test" },
    };
    const layer = makeOpenTelemetrySystemTelemetryLayer(opts);
    const program = Effect.gen(function* () {
      const telemetry = yield* SystemTelemetry;
      return yield* telemetry.withOperation(
        "phax.layer.smoke",
        { "phax.run.id": runId },
        Effect.succeed("ok"),
      );
    });
    const result = await Effect.runPromise(Effect.provide(program, layer));
    expect(result).toBe("ok");
  });
});
