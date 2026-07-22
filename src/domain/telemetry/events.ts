import type { RunId } from "../branded.js";
import type { SecurityMode } from "../security/types.js";
import type { ModelFamily, ProviderId, Relationship, ThinkingLevel } from "../routing/types.js";

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
  readonly selectedProvider: ProviderId;
  readonly selectedFamily: ModelFamily;
  readonly selectedConcreteModel: string;
  readonly selectedThinking?: ThinkingLevel;
  readonly relationship: Relationship;
  readonly reason: string;
}

export interface SecurityPolicyAppliedTelemetryEvent {
  readonly type: "security.policy.applied";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly mode: SecurityMode;
  readonly provider: ProviderId;
  readonly sandboxEnabled: boolean;
  readonly networkProfile: string;
  readonly mcpMode: string;
  readonly downgraded: boolean;
  readonly skippedForSecurity: readonly {
    readonly provider: ProviderId;
    readonly reason: string;
  }[];
}

export interface OrientBriefComputedTelemetryEvent {
  readonly type: "orient.brief.computed";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly phase: string;
  readonly fileCount: number;
  readonly rowCount: number;
}

export interface OrientPullServedTelemetryEvent {
  readonly type: "orient.pull.served";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly kind: "expand" | "file";
  readonly subject: string;
}

export interface OrientPullEmptyTelemetryEvent {
  readonly type: "orient.pull.empty";
  readonly runId: RunId;
  readonly operationId?: string;
  readonly kind: "expand" | "file";
  readonly subject: string;
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
  | ModelResolvedTelemetryEvent
  | SecurityPolicyAppliedTelemetryEvent
  | OrientBriefComputedTelemetryEvent
  | OrientPullServedTelemetryEvent
  | OrientPullEmptyTelemetryEvent;

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

export const makeSecurityPolicyAppliedTelemetryEvent = (
  fields: Omit<SecurityPolicyAppliedTelemetryEvent, "type">,
): SecurityPolicyAppliedTelemetryEvent => ({
  type: "security.policy.applied",
  ...fields,
});

export const makeOrientBriefComputedTelemetryEvent = (
  fields: Omit<OrientBriefComputedTelemetryEvent, "type">,
): OrientBriefComputedTelemetryEvent => ({ type: "orient.brief.computed", ...fields });

export const makeOrientPullServedTelemetryEvent = (
  fields: Omit<OrientPullServedTelemetryEvent, "type">,
): OrientPullServedTelemetryEvent => ({ type: "orient.pull.served", ...fields });

export const makeOrientPullEmptyTelemetryEvent = (
  fields: Omit<OrientPullEmptyTelemetryEvent, "type">,
): OrientPullEmptyTelemetryEvent => ({ type: "orient.pull.empty", ...fields });
