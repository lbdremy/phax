import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";
import { SurfaceSchema } from "./surface.js";

const GateStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: SurfaceSchema,
  result: Schema.Literal("pass", "fail", "pending"),
});

export type GateStepResult = Schema.Schema.Type<typeof GateStepResultSchema>;

const gateAttributionFields = {
  phase: Schema.NonEmptyString,
  steps: Schema.Array(GateStepResultSchema),
};

export const GateAttributionSchema = Schema.Struct(gateAttributionFields);

export type GateAttribution = Schema.Schema.Type<typeof GateAttributionSchema>;

/**
 * `gate-attribution.json` as phax writes it: `$schema` first, then the
 * attribution's fields. Unknown keys are ignored.
 */
export const GateAttributionFileSchema = Schema.Struct({
  $schema: schemaUrlField("gate-attribution"),
  ...gateAttributionFields,
});

export type GateAttributionFile = Schema.Schema.Type<typeof GateAttributionFileSchema>;

export const decodeGateAttributionFile = Schema.decodeUnknownEither(GateAttributionFileSchema);
export const encodeGateAttributionFile = Schema.encodeSync(GateAttributionFileSchema);
