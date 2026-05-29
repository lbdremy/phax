import type { SemanticTelemetryEvent } from "./events.js";

/** Stable projection of a semantic event — no transport or correlation fields. */
export interface SemanticTraceSnapshotEntry {
  readonly type: string;
  readonly operationId?: string;
  // state.transition
  readonly event?: string;
  readonly stateBefore?: string;
  readonly stateAfter?: string;
  readonly dispatcher?: string;
  // adapter.*
  readonly adapter?: string;
  readonly operation?: string;
  readonly expected?: string;
  readonly actual?: string;
  // step.*
  readonly step?: string;
  // gate.evaluated
  readonly gate?: string;
  readonly reason?: string;
  // artifact.generated
  readonly artifact?: string;
  readonly path?: string;
  // shared result field
  readonly result?: string;
}

export type SemanticTraceSnapshot = ReadonlyArray<SemanticTraceSnapshotEntry>;

export const projectEvent = (e: SemanticTelemetryEvent): SemanticTraceSnapshotEntry => {
  const opId = e.operationId !== undefined ? { operationId: e.operationId } : {};

  switch (e.type) {
    case "state.transition":
      return {
        type: e.type,
        ...opId,
        event: e.event,
        stateBefore: e.stateBefore,
        stateAfter: e.stateAfter,
        dispatcher: e.dispatcher,
      };
    case "adapter.call.started":
      return { type: e.type, ...opId, adapter: e.adapter, operation: e.operation };
    case "adapter.call.succeeded":
      return { type: e.type, ...opId, adapter: e.adapter, operation: e.operation };
    case "adapter.call.failed":
      return {
        type: e.type,
        ...opId,
        adapter: e.adapter,
        operation: e.operation,
        ...(e.expected !== undefined ? { expected: e.expected } : {}),
        ...(e.actual !== undefined ? { actual: e.actual } : {}),
      };
    case "step.started":
      return { type: e.type, ...opId, step: e.step };
    case "step.completed":
      return { type: e.type, ...opId, step: e.step, result: e.result };
    case "gate.evaluated":
      return {
        type: e.type,
        ...opId,
        gate: e.gate,
        result: e.result,
        ...(e.reason !== undefined ? { reason: e.reason } : {}),
      };
    case "artifact.generated":
      return { type: e.type, ...opId, artifact: e.artifact, path: e.path };
  }
};
