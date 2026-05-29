import { Cause, Effect, Exit, Layer, Option } from "effect";
import {
  context as otelContext,
  trace as otelTrace,
  SpanStatusCode,
  type Counter,
  type Histogram,
  type Meter,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type {
  SemanticTelemetryEvent,
  StateTransitionTelemetryEvent,
} from "../../domain/telemetry/events.js";
import type { SystemErrorReport } from "../../domain/telemetry/errors.js";
import {
  SystemTelemetry,
  type SystemTelemetryOps,
  type TelemetryAttributes,
} from "../../ports/systemTelemetry.js";

export interface OpenTelemetryAdapterOptions {
  readonly tracerName: string;
  readonly meterName: string;
  readonly resourceAttributes: TelemetryAttributes;
}

const omitUndefined = (
  input: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean> => {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
};

const causeToError = <E>(cause: Cause.Cause<E>): Error => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    const v = failure.value;
    return v instanceof Error ? v : new Error(String(v));
  }
  return new Error(Cause.pretty(cause));
};

export const makeOpenTelemetrySystemTelemetryOps = (
  tracer: Tracer,
  meter: Meter,
): SystemTelemetryOps => {
  const spanStack: Span[] = [];
  const erroredSpans = new WeakSet<Span>();
  const counters = new Map<string, Counter>();
  const histograms = new Map<string, Histogram>();

  const getCounter = (name: string): Counter => {
    const existing = counters.get(name);
    if (existing !== undefined) return existing;
    const created = meter.createCounter(name);
    counters.set(name, created);
    return created;
  };

  const getHistogram = (name: string): Histogram => {
    const existing = histograms.get(name);
    if (existing !== undefined) return existing;
    const created = meter.createHistogram(name);
    histograms.set(name, created);
    return created;
  };

  const currentSpan = (): Span | undefined => spanStack[spanStack.length - 1];

  return {
    withOperation<A, E, R>(
      name: string,
      attrs: TelemetryAttributes,
      operation: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> {
      return Effect.acquireUseRelease(
        Effect.sync(() => {
          const parent = currentSpan();
          const parentCtx =
            parent !== undefined
              ? otelTrace.setSpan(otelContext.active(), parent)
              : otelContext.active();
          const span = tracer.startSpan(name, { attributes: { ...attrs } }, parentCtx);
          spanStack.push(span);
          return span;
        }),
        () => operation,
        (span, exit) =>
          Effect.sync(() => {
            if (Exit.isFailure(exit)) {
              span.setStatus({ code: SpanStatusCode.ERROR });
              span.recordException(causeToError(exit.cause));
            } else if (!erroredSpans.has(span)) {
              span.setStatus({ code: SpanStatusCode.OK });
            }
            span.end();
            const idx = spanStack.lastIndexOf(span);
            if (idx !== -1) spanStack.splice(idx, 1);
          }),
      );
    },

    recordEvent(event: SemanticTelemetryEvent): Effect.Effect<void, never, never> {
      return Effect.sync(() => {
        const span = currentSpan();
        if (span === undefined) return;
        const { type, ...rest } = event;
        span.addEvent(type, omitUndefined(rest));
      });
    },

    recordTransition(transition: StateTransitionTelemetryEvent): Effect.Effect<void, never, never> {
      return Effect.sync(() => {
        const span = currentSpan();
        if (span === undefined) return;
        const { type, ...rest } = transition;
        span.addEvent(type, omitUndefined(rest));
      });
    },

    recordError(report: SystemErrorReport): Effect.Effect<void, never, never> {
      return Effect.sync(() => {
        const span = currentSpan();
        if (span === undefined) return;
        const { cause, type: _type, ...rest } = report;
        span.addEvent("error", { type: report.type, ...omitUndefined(rest) });
        span.setStatus({ code: SpanStatusCode.ERROR });
        erroredSpans.add(span);
        const error = cause instanceof Error ? cause : new Error(String(cause));
        span.recordException(error);
      });
    },

    incrementCounter(name: string, attrs?: TelemetryAttributes): Effect.Effect<void, never, never> {
      return Effect.sync(() => {
        getCounter(name).add(1, attrs !== undefined ? { ...attrs } : undefined);
      });
    },

    recordDuration(
      name: string,
      durationMs: number,
      attrs?: TelemetryAttributes,
    ): Effect.Effect<void, never, never> {
      return Effect.sync(() => {
        getHistogram(name).record(durationMs, attrs !== undefined ? { ...attrs } : undefined);
      });
    },
  };
};

export const makeOpenTelemetrySystemTelemetryLayer = (
  opts: OpenTelemetryAdapterOptions,
): Layer.Layer<SystemTelemetry> =>
  Layer.sync(SystemTelemetry, () => {
    const resource = resourceFromAttributes({ ...opts.resourceAttributes });
    const tracerProvider = new BasicTracerProvider({ resource });
    const meterProvider = new MeterProvider({ resource });
    const tracer = tracerProvider.getTracer(opts.tracerName);
    const meter = meterProvider.getMeter(opts.meterName);
    return makeOpenTelemetrySystemTelemetryOps(tracer, meter);
  });
