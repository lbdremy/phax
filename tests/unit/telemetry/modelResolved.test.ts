import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRunId } from "../../../src/domain/branded.js";
import { makeModelResolvedTelemetryEvent } from "../../../src/domain/telemetry/events.js";
import { projectEvent } from "../../../src/domain/telemetry/snapshot.js";
import { decodeSemanticTelemetryEvent } from "../../../src/schemas/telemetryEvents.js";

const runId = Either.getOrThrow(decodeRunId("test-run-001"));

const baseFields = {
  runId,
  requestedFamily: "claude-sonnet" as const,
  requestedEffort: "medium" as const,
  normalizedTier: "standard" as const,
  selectedProvider: "mistral-vibe" as const,
  selectedFamily: "mistral-medium" as const,
  selectedConcreteModel: "phax-mistral-medium-3.5-medium",
  selectedThinking: "medium" as const,
  relationship: "equivalent" as const,
  reason: "Provider priority selected mistral-vibe; claude-sonnet medium maps to standard tier.",
};

describe("makeModelResolvedTelemetryEvent", () => {
  it("sets type to agent.model.resolved", () => {
    const event = makeModelResolvedTelemetryEvent(baseFields);
    expect(event.type).toBe("agent.model.resolved");
  });

  it("produces a value the schema accepts", () => {
    const event = makeModelResolvedTelemetryEvent(baseFields);
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });

  it("preserves optional operationId when provided", () => {
    const event = makeModelResolvedTelemetryEvent({ ...baseFields, operationId: "phase-01" });
    expect(event.operationId).toBe("phase-01");
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });

  it("accepts event without optional selectedThinking", () => {
    const { selectedThinking: _t, ...fields } = baseFields;
    const event = makeModelResolvedTelemetryEvent(fields);
    expect(event.selectedThinking).toBeUndefined();
    expect(Either.isRight(decodeSemanticTelemetryEvent(event))).toBe(true);
  });

  it("schema rejects invalid relationship value", () => {
    const event = { ...makeModelResolvedTelemetryEvent(baseFields), relationship: "bad_value" };
    expect(Either.isLeft(decodeSemanticTelemetryEvent(event))).toBe(true);
  });

  it("schema rejects invalid provider id", () => {
    const event = {
      ...makeModelResolvedTelemetryEvent(baseFields),
      selectedProvider: "unknown-provider",
    };
    expect(Either.isLeft(decodeSemanticTelemetryEvent(event))).toBe(true);
  });
});

describe("projectEvent for agent.model.resolved", () => {
  it("drops runId", () => {
    const entry = projectEvent(makeModelResolvedTelemetryEvent(baseFields));
    expect("runId" in entry).toBe(false);
  });

  it("preserves all semantic payload fields", () => {
    const entry = projectEvent(makeModelResolvedTelemetryEvent(baseFields));
    expect(entry).toMatchObject({
      type: "agent.model.resolved",
      requestedFamily: "claude-sonnet",
      requestedEffort: "medium",
      normalizedTier: "standard",
      selectedProvider: "mistral-vibe",
      selectedFamily: "mistral-medium",
      selectedConcreteModel: "phax-mistral-medium-3.5-medium",
      selectedThinking: "medium",
      relationship: "equivalent",
    });
  });

  it("omits selectedThinking when absent", () => {
    const { selectedThinking: _t, ...fields } = baseFields;
    const entry = projectEvent(makeModelResolvedTelemetryEvent(fields));
    expect("selectedThinking" in entry).toBe(false);
  });

  it("preserves operationId when present", () => {
    const entry = projectEvent(
      makeModelResolvedTelemetryEvent({ ...baseFields, operationId: "phase-01" }),
    );
    expect(entry.operationId).toBe("phase-01");
  });
});
