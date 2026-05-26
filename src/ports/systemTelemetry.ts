import { Context, Effect, Layer } from "effect";
import type {
  StateTransitionTelemetryEvent,
  SemanticTelemetryEvent,
} from "../domain/telemetry/events.js";
import type { SystemErrorReport } from "../domain/telemetry/errors.js";

export type TelemetryAttributes = Readonly<Record<string, string | number | boolean>>;

export interface SystemTelemetryOps {
  withOperation<A, E, R>(
    name: string,
    attrs: TelemetryAttributes,
    operation: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R>;

  recordEvent(event: SemanticTelemetryEvent): Effect.Effect<void, never, never>;

  recordTransition(transition: StateTransitionTelemetryEvent): Effect.Effect<void, never, never>;

  recordError(report: SystemErrorReport): Effect.Effect<void, never, never>;

  incrementCounter(name: string, attrs?: TelemetryAttributes): Effect.Effect<void, never, never>;

  recordDuration(
    name: string,
    durationMs: number,
    attrs?: TelemetryAttributes,
  ): Effect.Effect<void, never, never>;
}

export class SystemTelemetry extends Context.Tag("phax/SystemTelemetry")<
  SystemTelemetry,
  SystemTelemetryOps
>() {}

export const NoopSystemTelemetryLayer: Layer.Layer<SystemTelemetry> = Layer.succeed(
  SystemTelemetry,
  {
    withOperation: <A, E, R>(
      _name: string,
      _attrs: TelemetryAttributes,
      operation: Effect.Effect<A, E, R>,
    ) => operation,
    recordEvent: (_event) => Effect.void,
    recordTransition: (_transition) => Effect.void,
    recordError: (_report) => Effect.void,
    incrementCounter: (_name, _attrs) => Effect.void,
    recordDuration: (_name, _durationMs, _attrs) => Effect.void,
  },
);
