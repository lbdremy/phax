import { Effect, Layer } from "effect";
import type { RunId } from "../../domain/branded.js";
import type { SemanticTelemetryEvent } from "../../domain/telemetry/events.js";
import type { SystemErrorReport } from "../../domain/telemetry/errors.js";
import type { StateTransitionTelemetryEvent } from "../../domain/telemetry/events.js";
import { FileSystem } from "../../ports/fs.js";
import type { OutputPort } from "../../ports/output.js";
import {
  SystemTelemetry,
  type SystemTelemetryOps,
  type TelemetryAttributes,
} from "../../ports/systemTelemetry.js";
import { InMemoryTelemetry } from "./inMemory.js";
import { makeJsonFileTelemetryOps } from "./jsonFile.js";
import { makeCompositeOps } from "./composite.js";

export interface TelemetryFactoryInput {
  readonly output: OutputPort;
  readonly verbose: boolean;
  readonly tracePath?: string;
  readonly runId: RunId;
}

const formatSemanticEvent = (event: SemanticTelemetryEvent): string => {
  switch (event.type) {
    case "state.transition":
      return `phax·state.transition  ${event.stateBefore}→${event.stateAfter}  (via '${event.event}')`;
    case "adapter.call.started":
      return `phax·adapter.call.started  ${event.adapter}/${event.operation}`;
    case "adapter.call.succeeded":
      return `phax·adapter.call.succeeded  ${event.adapter}/${event.operation}`;
    case "adapter.call.failed":
      return `phax·adapter.call.failed  ${event.adapter}/${event.operation}  exit=${event.exitCode}`;
    case "step.started":
      return `phax·step.started  ${event.step}`;
    case "step.completed":
      return `phax·step.completed  ${event.step}  result=${event.result}`;
    case "gate.evaluated":
      return `phax·gate.evaluated  ${event.gate}  result=${event.result}${event.reason !== undefined ? `  reason=${event.reason}` : ""}`;
    case "artifact.generated":
      return `phax·artifact.generated  ${event.artifact}  path=${event.path}`;
    case "agent.model.resolved":
      return `phax·agent.model.resolved  ${event.selectedProvider}/${event.selectedFamily}  model=${event.selectedConcreteModel}  relationship=${event.relationship}`;
    case "security.policy.applied":
      return `phax·security.policy.applied  mode=${event.mode}  provider=${event.provider}  sandbox=${event.sandboxEnabled}  network=${event.networkProfile}  mcp=${event.mcpMode}${event.downgraded ? "  DOWNGRADED" : ""}${event.skippedForSecurity.length > 0 ? `  skipped=[${event.skippedForSecurity.map((s) => s.provider).join(",")}]` : ""}`;
  }
};

const makeVerboseRendererOps = (output: OutputPort): SystemTelemetryOps => ({
  withOperation<A, E, R>(
    _name: string,
    _attrs: TelemetryAttributes,
    operation: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> {
    return operation;
  },

  recordEvent(event: SemanticTelemetryEvent): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      output.log(formatSemanticEvent(event));
    });
  },

  recordTransition(transition: StateTransitionTelemetryEvent): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      output.log(formatSemanticEvent(transition));
    });
  },

  recordError(report: SystemErrorReport): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      const location =
        report.adapter !== undefined ? `  ${report.adapter}/${report.operation ?? "?"}` : "";
      output.error(`phax·error  type=${report.type}${location}`);
    });
  },

  incrementCounter(_name: string, _attrs?: TelemetryAttributes): Effect.Effect<void, never, never> {
    return Effect.void;
  },

  recordDuration(
    _name: string,
    _durationMs: number,
    _attrs?: TelemetryAttributes,
  ): Effect.Effect<void, never, never> {
    return Effect.void;
  },
});

/**
 * Build a SystemTelemetry layer from CLI flags and env vars.
 *
 * Composition order (leftmost = outermost scope in withOperation):
 *   Verbose (opt-in) > JsonFile (opt-in) > InMemory (always)
 *
 * The in-memory adapter is always included as an internal side channel; it is
 * not exposed by default — callers that need it should use `makeFakeSystemTelemetry`
 * or compose their own layer.
 *
 * Requires `FileSystem` from context (used only when `tracePath` is set).
 */
export const makeSystemTelemetryLayer = (
  input: TelemetryFactoryInput,
): Layer.Layer<SystemTelemetry, never, FileSystem> =>
  Layer.effect(
    SystemTelemetry,
    Effect.gen(function* () {
      const ops: SystemTelemetryOps[] = [];

      // InMemory is always present (innermost = last in the array).
      ops.push(new InMemoryTelemetry());

      // JsonFile when tracePath is set — uses FileSystem from context.
      if (input.tracePath !== undefined) {
        const fs = yield* FileSystem;
        ops.push(makeJsonFileTelemetryOps(input.tracePath, fs));
      }

      // Verbose renderer when verbose flag is on.
      if (input.verbose) {
        ops.push(makeVerboseRendererOps(input.output));
      }

      return makeCompositeOps(ops);
    }),
  );
