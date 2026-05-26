import { Schema } from "effect";

const StateTransitionTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("state.transition"),
  runId: Schema.String.pipe(Schema.minLength(1)),
  operationId: Schema.optional(Schema.String),
  event: Schema.String,
  stateBefore: Schema.String,
  stateAfter: Schema.String,
  dispatcher: Schema.String,
});

const AdapterCallStartedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("adapter.call.started"),
  runId: Schema.String.pipe(Schema.minLength(1)),
  operationId: Schema.optional(Schema.String),
  adapter: Schema.String,
  operation: Schema.String,
});

const AdapterCallSucceededTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("adapter.call.succeeded"),
  runId: Schema.String.pipe(Schema.minLength(1)),
  operationId: Schema.optional(Schema.String),
  adapter: Schema.String,
  operation: Schema.String,
});

const AdapterCallFailedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("adapter.call.failed"),
  runId: Schema.String.pipe(Schema.minLength(1)),
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
  runId: Schema.String.pipe(Schema.minLength(1)),
  operationId: Schema.optional(Schema.String),
  step: Schema.String,
});

const StepCompletedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("step.completed"),
  runId: Schema.String.pipe(Schema.minLength(1)),
  operationId: Schema.optional(Schema.String),
  step: Schema.String,
  result: Schema.Literal("success", "failure"),
});

const GateEvaluatedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("gate.evaluated"),
  runId: Schema.String.pipe(Schema.minLength(1)),
  operationId: Schema.optional(Schema.String),
  gate: Schema.String,
  result: Schema.Literal("accepted", "rejected"),
  reason: Schema.optional(Schema.String),
});

const ArtifactGeneratedTelemetryEventSchema = Schema.Struct({
  type: Schema.Literal("artifact.generated"),
  runId: Schema.String.pipe(Schema.minLength(1)),
  operationId: Schema.optional(Schema.String),
  artifact: Schema.String,
  path: Schema.String,
});

export const SemanticTelemetryEventSchema = Schema.Union(
  StateTransitionTelemetryEventSchema,
  AdapterCallStartedTelemetryEventSchema,
  AdapterCallSucceededTelemetryEventSchema,
  AdapterCallFailedTelemetryEventSchema,
  StepStartedTelemetryEventSchema,
  StepCompletedTelemetryEventSchema,
  GateEvaluatedTelemetryEventSchema,
  ArtifactGeneratedTelemetryEventSchema,
);

export type SemanticTelemetryEventFromSchema = Schema.Schema.Type<
  typeof SemanticTelemetryEventSchema
>;

export const decodeSemanticTelemetryEvent = Schema.decodeUnknownEither(
  SemanticTelemetryEventSchema,
);
