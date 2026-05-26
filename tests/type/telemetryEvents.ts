import type { RunId } from "../../src/domain/branded.js";
import type {
  SemanticTelemetryEvent,
  StateTransitionTelemetryEvent,
} from "../../src/domain/telemetry/events.js";
import {
  makeStateTransitionTelemetryEvent,
  makeStepStartedTelemetryEvent,
} from "../../src/domain/telemetry/events.js";

declare const runId: RunId;

// Smart constructors enforce required fields at the type level.

// Legal construction — all required fields provided:
const validEvent = makeStateTransitionTelemetryEvent({
  runId,
  event: "RUN_STARTED",
  stateBefore: "idle",
  stateAfter: "running",
  dispatcher: "dispatcher.ts",
});

// @ts-expect-error: missing required field `event`
const missingEvent = makeStateTransitionTelemetryEvent({
  runId,
  stateBefore: "idle",
  stateAfter: "running",
  dispatcher: "dispatcher.ts",
});

// @ts-expect-error: missing required field `step`
const missingStep = makeStepStartedTelemetryEvent({ runId });

// The discriminated union is exhaustive and assignable to SemanticTelemetryEvent:
const asUnion: SemanticTelemetryEvent = validEvent;

// Type is narrowed to the specific variant:
const narrowed: StateTransitionTelemetryEvent = validEvent;

void validEvent;
void missingEvent;
void missingStep;
void asUnion;
void narrowed;
