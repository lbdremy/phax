import { makeInMemoryTelemetryLayer } from "../../../src/infra/telemetry/inMemory.js";
import { makeCompositeSystemTelemetryLayer } from "../../../src/infra/telemetry/composite.js";
import type { InMemoryTelemetry } from "../../../src/infra/telemetry/inMemory.js";
import type { SystemTelemetry } from "../../../src/ports/systemTelemetry.js";
import type { Layer } from "effect";

/**
 * Wraps an existing telemetry layer with an InMemoryTelemetry side-channel for
 * snapshot capture. The primary layer continues to emit to its own outputs; the
 * InMemoryTelemetry captures every event for `getSemanticTraceSnapshot()`.
 *
 * Usage: pass `NoopSystemTelemetryLayer` as the primary when no real output is needed,
 * or a `makeSystemTelemetryLayer(...)` instance to also emit verbose / JSONL output.
 */
export function withTelemetryCapture(primaryLayer: Layer.Layer<SystemTelemetry>): {
  impl: InMemoryTelemetry;
  layer: Layer.Layer<SystemTelemetry>;
} {
  const { impl, layer: captureLayer } = makeInMemoryTelemetryLayer();
  const layer = makeCompositeSystemTelemetryLayer([primaryLayer, captureLayer]);
  return { impl, layer };
}
