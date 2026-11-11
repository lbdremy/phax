import { Schema } from "effect";
import {
  ModelFamilySchema,
  ProviderIdSchema,
  RelationshipSchema,
  ThinkingLevelSchema,
} from "./modelRouting.js";

const StateTransitionTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("state.transition"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.optional(Schema.String),
  event: Schema.String,
  stateBefore: Schema.String,
  stateAfter: Schema.String,
  dispatcher: Schema.String,
});

const AdapterCallStartedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("adapter.call.started"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.optional(Schema.String),
  adapter: Schema.String,
  operation: Schema.String,
});

const AdapterCallSucceededTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("adapter.call.succeeded"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.optional(Schema.String),
  adapter: Schema.String,
  operation: Schema.String,
});

const AdapterCallFailedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("adapter.call.failed"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.optional(Schema.String),
  adapter: Schema.String,
  operation: Schema.String,
  expected: Schema.optional(Schema.String),
  actual: Schema.optional(Schema.String),
  exitCode: Schema.Number,
  stderrExcerpt: Schema.String,
});

const StepStartedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("step.started"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.optional(Schema.String),
  step: Schema.String,
});

const StepCompletedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("step.completed"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.optional(Schema.String),
  step: Schema.String,
  result: Schema.Literals(["success", "failure"]),
});

const GateEvaluatedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("gate.evaluated"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.optional(Schema.String),
  gate: Schema.String,
  result: Schema.Literals(["accepted", "rejected"]),
  reason: Schema.optional(Schema.String),
});

const ArtifactGeneratedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("artifact.generated"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.optional(Schema.String),
  artifact: Schema.String,
  path: Schema.String,
});

const ModelResolvedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("agent.model.resolved"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.optional(Schema.String),
  requestedFamily: ModelFamilySchema,
  requestedEffort: ThinkingLevelSchema,
  selectedProvider: ProviderIdSchema,
  selectedFamily: ModelFamilySchema,
  selectedConcreteModel: Schema.String.check(Schema.isMinLength(1)),
  selectedThinking: Schema.optional(ThinkingLevelSchema),
  relationship: RelationshipSchema,
  reason: Schema.String.check(Schema.isMinLength(1)),
});

const SecurityPolicyAppliedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("security.policy.applied"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.optional(Schema.String),
  mode: Schema.Literals(["secure", "unsafe", "isolated"]),
  provider: ProviderIdSchema,
  sandboxEnabled: Schema.Boolean,
  networkProfile: Schema.String.check(Schema.isMinLength(1)),
  mcpMode: Schema.String.check(Schema.isMinLength(1)),
  downgraded: Schema.Boolean,
  skippedForSecurity: Schema.Array(
    Schema.Struct({
      provider: ProviderIdSchema,
      reason: Schema.String.check(Schema.isMinLength(1)),
    }),
  ),
});

const AcceptanceEditsUnjudgedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("acceptance.edits.unjudged"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.String,
  files: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
});

const StopTranscriptTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("stop.transcript"),
  runId: Schema.String.check(Schema.isMinLength(1)),
  operationId: Schema.String,
  sessionId: Schema.String.check(Schema.isMinLength(1)),
  provider: ProviderIdSchema,
  outcome: Schema.Literals(["captured", "missing"]),
  reason: Schema.optional(Schema.Literals(["not-found", "unreadable"])),
});

export const SemanticTelemetryEventSchema = Schema.Union([
  StateTransitionTelemetryEventSchema,
  AdapterCallStartedTelemetryEventSchema,
  AdapterCallSucceededTelemetryEventSchema,
  AdapterCallFailedTelemetryEventSchema,
  StepStartedTelemetryEventSchema,
  StepCompletedTelemetryEventSchema,
  GateEvaluatedTelemetryEventSchema,
  ArtifactGeneratedTelemetryEventSchema,
  ModelResolvedTelemetryEventSchema,
  SecurityPolicyAppliedTelemetryEventSchema,
  AcceptanceEditsUnjudgedTelemetryEventSchema,
  StopTranscriptTelemetryEventSchema,
]);

export type SemanticTelemetryEventFromSchema = Schema.Schema.Type<
  typeof SemanticTelemetryEventSchema
>;

export const decodeSemanticTelemetryEvent = Schema.decodeUnknownResult(
  SemanticTelemetryEventSchema,
  { reportInput: true },
);
