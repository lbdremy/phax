import type { RunId } from "../branded.js";
import type {
  ModelFamily,
  ProviderId,
  Relationship,
  RoutingTier,
  ThinkingLevel,
} from "../routing/types.js";

export interface StateTransitionTelemetryEvent {
  readonly type: "state.transition";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly event: string;
  readonly stateBefore: string;
  readonly stateAfter: string;
  readonly dispatcher: string;
}

export interface AdapterCallStartedTelemetryEvent {
  readonly type: "adapter.call.started";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly adapter: string;
  readonly operation: string;
}

export interface AdapterCallSucceededTelemetryEvent {
  readonly type: "adapter.call.succeeded";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly adapter: string;
  readonly operation: string;
}

export interface AdapterCallFailedTelemetryEvent {
  readonly type: "adapter.call.failed";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly adapter: string;
  readonly operation: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly exitCode: number;
  readonly stderrExcerpt: string;
}

export interface StepStartedTelemetryEvent {
  readonly type: "step.started";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly step: string;
}

export interface StepCompletedTelemetryEvent {
  readonly type: "step.completed";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly step: string;
  readonly result: "success" | "failure";
}

export interface GateEvaluatedTelemetryEvent {
  readonly type: "gate.evaluated";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly gate: string;
  readonly result: "accepted" | "rejected";
  readonly reason?: string;
}

export interface ArtifactGeneratedTelemetryEvent {
  readonly type: "artifact.generated";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly artifact: string;
  readonly path: string;
}

export interface ModelResolvedTelemetryEvent {
  readonly type: "agent.model.resolved";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly requestedFamily: ModelFamily;
  readonly requestedEffort: ThinkingLevel;
  readonly normalizedTier: RoutingTier;
  readonly selectedProvider: ProviderId;
  readonly selectedFamily: ModelFamily;
  readonly selectedConcreteModel: string;
  readonly selectedThinking?: ThinkingLevel;
  readonly relationship: Relationship;
  readonly reason: string;
}

export type SemanticTelemetryEvent =
  | StateTransitionTelemetryEvent
  | AdapterCallStartedTelemetryEvent
  | AdapterCallSucceededTelemetryEvent
  | AdapterCallFailedTelemetryEvent
  | StepStartedTelemetryEvent
  | StepCompletedTelemetryEvent
  | GateEvaluatedTelemetryEvent
  | ArtifactGeneratedTelemetryEvent
  | ModelResolvedTelemetryEvent;

export const makeStateTransitionTelemetryEvent = (
  fields: Omit<StateTransitionTelemetryEvent, "type">,
): StateTransitionTelemetryEvent => ({ type: "state.transition", ...fields });

export const makeAdapterCallStartedTelemetryEvent = (
  fields: Omit<AdapterCallStartedTelemetryEvent, "type">,
): AdapterCallStartedTelemetryEvent => ({ type: "adapter.call.started", ...fields });

export const makeAdapterCallSucceededTelemetryEvent = (
  fields: Omit<AdapterCallSucceededTelemetryEvent, "type">,
): AdapterCallSucceededTelemetryEvent => ({ type: "adapter.call.succeeded", ...fields });

export const makeAdapterCallFailedTelemetryEvent = (
  fields: Omit<AdapterCallFailedTelemetryEvent, "type">,
): AdapterCallFailedTelemetryEvent => ({ type: "adapter.call.failed", ...fields });

export const makeStepStartedTelemetryEvent = (
  fields: Omit<StepStartedTelemetryEvent, "type">,
): StepStartedTelemetryEvent => ({ type: "step.started", ...fields });

export const makeStepCompletedTelemetryEvent = (
  fields: Omit<StepCompletedTelemetryEvent, "type">,
): StepCompletedTelemetryEvent => ({ type: "step.completed", ...fields });

export const makeGateEvaluatedTelemetryEvent = (
  fields: Omit<GateEvaluatedTelemetryEvent, "type">,
): GateEvaluatedTelemetryEvent => ({ type: "gate.evaluated", ...fields });

export const makeArtifactGeneratedTelemetryEvent = (
  fields: Omit<ArtifactGeneratedTelemetryEvent, "type">,
): ArtifactGeneratedTelemetryEvent => ({ type: "artifact.generated", ...fields });

export const makeModelResolvedTelemetryEvent = (
  fields: Omit<ModelResolvedTelemetryEvent, "type">,
): ModelResolvedTelemetryEvent => ({ type: "agent.model.resolved", ...fields });
