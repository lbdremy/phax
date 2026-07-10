import { Schema } from "effect";

const GateStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: Schema.NonEmptyString,
  result: Schema.Literal("pass", "fail"),
});

export type GateStepResult = Schema.Schema.Type<typeof GateStepResultSchema>;

export const GateAttributionSchema = Schema.Struct({
  phase: Schema.NonEmptyString,
  steps: Schema.Array(GateStepResultSchema),
});

export type GateAttribution = Schema.Schema.Type<typeof GateAttributionSchema>;

export const decodeGateAttribution = Schema.decodeUnknownEither(GateAttributionSchema);
export const encodeGateAttribution = Schema.encodeSync(GateAttributionSchema);
