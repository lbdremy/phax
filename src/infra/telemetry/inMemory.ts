import { Effect, Layer } from "effect";
import type {
  StateTransitionTelemetryEvent,
  SemanticTelemetryEvent,
} from "../../domain/telemetry/events.js";
import type { SystemErrorReport } from "../../domain/telemetry/errors.js";
import { projectEvent } from "../../domain/telemetry/snapshot.js";
import type { SemanticTraceSnapshot } from "../../domain/telemetry/snapshot.js";
import {
  SystemTelemetry,
  type SystemTelemetryOps,
  type TelemetryAttributes,
} from "../../ports/systemTelemetry.js";

export class InMemoryTelemetry implements SystemTelemetryOps {
  private readonly storedEvents: SemanticTelemetryEvent[] = [];
  private readonly storedErrors: SystemErrorReport[] = [];
  private readonly storedCounters = new Map<string, number>();
  private readonly storedDurations = new Map<string, number[]>();
  private readonly operationStack: Array<{ name: string; attrs: TelemetryAttributes }> = [];

  withOperation<A, E, R>(
    name: string,
    attrs: TelemetryAttributes,
    operation: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        this.operationStack.push({ name, attrs });
      }),
      () => operation,
      () =>
        Effect.sync(() => {
          this.operationStack.pop();
        }),
    );
  }

  recordEvent(event: SemanticTelemetryEvent): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      this.storedEvents.push(event);
    });
  }

  recordTransition(transition: StateTransitionTelemetryEvent): Effect.Effect<void, never, never> {
    return this.recordEvent(transition);
  }

  recordError(report: SystemErrorReport): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      this.storedErrors.push(report);
    });
  }

  incrementCounter(name: string, attrs?: TelemetryAttributes): Effect.Effect<void, never, never> {
    const key = attrs !== undefined ? `${name}:${JSON.stringify(attrs)}` : name;
    return Effect.sync(() => {
      this.storedCounters.set(key, (this.storedCounters.get(key) ?? 0) + 1);
    });
  }

  recordDuration(
    name: string,
    durationMs: number,
    _attrs?: TelemetryAttributes,
  ): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      const samples = this.storedDurations.get(name);
      if (samples !== undefined) {
        samples.push(durationMs);
      } else {
        this.storedDurations.set(name, [durationMs]);
      }
    });
  }

  events(): ReadonlyArray<SemanticTelemetryEvent> {
    return this.storedEvents;
  }

  errors(): ReadonlyArray<SystemErrorReport> {
    return this.storedErrors;
  }

  counters(): ReadonlyMap<string, number> {
    return this.storedCounters;
  }

  durations(): ReadonlyMap<string, ReadonlyArray<number>> {
    return this.storedDurations;
  }

  getSemanticTraceSnapshot(): SemanticTraceSnapshot {
    return this.storedEvents.map(projectEvent);
  }
}

export const makeInMemoryTelemetryLayer = (): {
  impl: InMemoryTelemetry;
  layer: Layer.Layer<SystemTelemetry>;
} => {
  const impl = new InMemoryTelemetry();
  const layer = Layer.succeed(SystemTelemetry, impl);
  return { impl, layer };
};
