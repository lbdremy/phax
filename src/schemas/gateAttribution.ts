import { Schema } from "effect";
import { SurfaceSchema } from "./surface.js";

const GateStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: SurfaceSchema,
  result: Schema.Literal("pass", "fail", "pending"),
});

export type GateStepResult = Schema.Schema.Type<typeof GateStepResultSchema>;

export const GateAttributionSchema = Schema.Struct({
  phase: Schema.NonEmptyString,
  steps: Schema.Array(GateStepResultSchema),
});

export type GateAttribution = Schema.Schema.Type<typeof GateAttributionSchema>;

/**
 * `gate-attribution.json` as phax writes it: today's schema until the file gains `$schema`.
 * @alias
 */
export const GateAttributionFileSchema = GateAttributionSchema;

export const decodeGateAttributionFile = Schema.decodeUnknownEither(GateAttributionFileSchema);
export const encodeGateAttribution = Schema.encodeSync(GateAttributionSchema);
