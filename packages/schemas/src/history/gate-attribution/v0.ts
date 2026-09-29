// Frozen: a phase's gate-attribution.json as phax has written it, with no
// version literal — shape v0 (copied from src/schemas/gateAttribution.ts at
// bfb8385e). Unknown keys are ignored, as phax's decoder ignores them.
// Pinned by hash in packages/schemas/history.lock.json — never edit.
// Self-contained: imports only effect, so later changes to phax's
// src/schemas cannot reach it.
import { Schema } from "effect";

const SurfaceSchema = Schema.Literal("local", "structural", "product");

const GateStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: SurfaceSchema,
  result: Schema.Literal("pass", "fail", "pending"),
});

export const GateAttributionV0Schema = Schema.Struct({
  phase: Schema.NonEmptyString,
  steps: Schema.Array(GateStepResultSchema),
});

export type GateAttributionV0 = Schema.Schema.Type<typeof GateAttributionV0Schema>;

export const decodeGateAttributionV0 = Schema.decodeUnknownEither(GateAttributionV0Schema);
