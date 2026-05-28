import { Effect, Exit, Layer } from "effect";
import type {
  StateTransitionTelemetryEvent,
  SemanticTelemetryEvent,
} from "../../domain/telemetry/events.js";
import type { SystemErrorReport } from "../../domain/telemetry/errors.js";
import { FileSystem, type FileSystemOps } from "../../ports/fs.js";
import {
  SystemTelemetry,
  type SystemTelemetryOps,
  type TelemetryAttributes,
} from "../../ports/systemTelemetry.js";

const swallowError = (
  eff: Effect.Effect<void, unknown, never>,
): Effect.Effect<void, never, never> => Effect.catchAll(eff, () => Effect.void);

export const makeJsonFileTelemetryOps = (path: string, fs: FileSystemOps): SystemTelemetryOps =>
  makeOps(path, fs);

const makeOps = (path: string, fs: FileSystemOps): SystemTelemetryOps => {
  const appendJson = (record: unknown): Effect.Effect<void, never, never> =>
    swallowError(fs.appendLine(path, JSON.stringify(record)));

  return {
    withOperation<A, E, R>(
      name: string,
      _attrs: TelemetryAttributes,
      operation: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> {
      return Effect.acquireUseRelease(
        appendJson({ kind: "step.started", step: name }),
        () => operation,
        (_, exit) =>
          appendJson({
            kind: "step.completed",
            step: name,
            result: Exit.isSuccess(exit) ? "success" : "failure",
          }),
      );
    },

    recordEvent(event: SemanticTelemetryEvent): Effect.Effect<void, never, never> {
      return appendJson(event);
    },

    recordTransition(transition: StateTransitionTelemetryEvent): Effect.Effect<void, never, never> {
      return appendJson(transition);
    },

    recordError(report: SystemErrorReport): Effect.Effect<void, never, never> {
      const { cause: _cause, ...rest } = report;
      return appendJson({ ...rest, type: `error.${report.type}` });
    },

    incrementCounter(name: string, attrs?: TelemetryAttributes): Effect.Effect<void, never, never> {
      return appendJson({
        kind: "metric.counter",
        name,
        ...(attrs !== undefined ? { attrs } : {}),
      });
    },

    recordDuration(
      name: string,
      durationMs: number,
      attrs?: TelemetryAttributes,
    ): Effect.Effect<void, never, never> {
      return appendJson({
        kind: "metric.duration",
        name,
        durationMs,
        ...(attrs !== undefined ? { attrs } : {}),
      });
    },
  };
};

export const makeJsonFileSystemTelemetryLayer = (
  path: string,
): Layer.Layer<SystemTelemetry, never, FileSystem> =>
  Layer.effect(
    SystemTelemetry,
    Effect.map(FileSystem, (fs) => makeOps(path, fs)),
  );
