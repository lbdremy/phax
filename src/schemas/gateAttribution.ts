import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";
import { SurfaceSchema } from "./surface.js";

/** A step of the phase's configured gate: surface local | structural | product. */
const ConfiguredStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: SurfaceSchema,
  result: Schema.Literal("pass", "fail", "refused"),
});

/**
 * The oracle step: carried only by the step phax appends at an oracle pair's
 * gate. `skipped` records `phax resume --skip-oracle`: the step was not run.
 */
const OracleStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: Schema.Literal("oracle"),
  result: Schema.Literal("pass", "fail", "refused", "skipped"),
});

export type OracleStepResult = Schema.Schema.Type<typeof OracleStepResultSchema>;

const GateStepResultSchema = Schema.Union(ConfiguredStepResultSchema, OracleStepResultSchema);

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
