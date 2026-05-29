import { Effect, Layer } from "effect";
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

export const makeCompositeOps = (
  implementations: ReadonlyArray<SystemTelemetryOps>,
): SystemTelemetryOps => {
  const fanOut = (
    fn: (impl: SystemTelemetryOps) => Effect.Effect<void, never, never>,
  ): Effect.Effect<void, never, never> =>
    Effect.all(
      implementations.map((impl) => Effect.catchAll(fn(impl), () => Effect.void)),
      { concurrency: 1 },
    ).pipe(Effect.asVoid);

  return {
    withOperation<A, E, R>(
      name: string,
      attrs: TelemetryAttributes,
      operation: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> {
      // Reduce right-to-left: leftmost impl becomes the outermost scope.
      return implementations.reduceRight(
        (inner: Effect.Effect<A, E, R>, impl) => impl.withOperation(name, attrs, inner),
        operation,
      );
    },

    recordEvent(event: SemanticTelemetryEvent): Effect.Effect<void, never, never> {
      return fanOut((impl) => impl.recordEvent(event));
    },

    recordTransition(transition: StateTransitionTelemetryEvent): Effect.Effect<void, never, never> {
      return fanOut((impl) => impl.recordTransition(transition));
    },

    recordError(report: SystemErrorReport): Effect.Effect<void, never, never> {
      return fanOut((impl) => impl.recordError(report));
    },

    incrementCounter(name: string, attrs?: TelemetryAttributes): Effect.Effect<void, never, never> {
      return fanOut((impl) => impl.incrementCounter(name, attrs));
    },

    recordDuration(
      name: string,
      durationMs: number,
      attrs?: TelemetryAttributes,
    ): Effect.Effect<void, never, never> {
      return fanOut((impl) => impl.recordDuration(name, durationMs, attrs));
    },
  };
};

/**
 * Fan out one logical SystemTelemetry call to multiple self-contained implementations.
 * Each layer in `layers` must have no external requirements (RIn = never).
 */
export const makeCompositeSystemTelemetryLayer = (
  layers: ReadonlyArray<Layer.Layer<SystemTelemetry>>,
): Layer.Layer<SystemTelemetry> =>
  Layer.effect(
    SystemTelemetry,
    Effect.gen(function* () {
      const impls: SystemTelemetryOps[] = [];
      for (const layer of layers) {
        const impl = yield* Effect.provide(SystemTelemetry, layer);
        impls.push(impl);
      }
      return makeCompositeOps(impls);
    }),
  );
