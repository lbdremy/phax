// The frozen pre-schema shape of `gate-attribution`: exactly what phax wrote
// before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
import { Schema } from "effect";

const SurfaceSchema = Schema.Literal("local", "structural", "product");

const GateStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: SurfaceSchema,
  result: Schema.Literal("pass", "fail", "pending"),
});

export const GateAttributionPreSchemaSchema = Schema.Struct({
  phase: Schema.NonEmptyString,
  steps: Schema.Array(GateStepResultSchema),
});

export type GateAttributionPreSchema = Schema.Schema.Type<typeof GateAttributionPreSchemaSchema>;

export const decodeGateAttributionPreSchema = Schema.decodeUnknownEither(
  GateAttributionPreSchemaSchema,
);
