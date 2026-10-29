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

/**
 * How a protected path changed in the phase, by what the observation shows:
 * `symlink` and `nested-repository` name a symbolic link or a nested
 * repository a protected glob could reach below, which the check cannot see
 * through.
 */
export const ProtectedChangeKindSchema = Schema.Literal(
  "created",
  "edited",
  "deleted",
  "renamed",
  "symlink",
  "nested-repository",
);

const ProtectedChangeSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  kind: ProtectedChangeKindSchema,
  entry: Schema.NonEmptyString,
});

export type ProtectedChange = Schema.Schema.Type<typeof ProtectedChangeSchema>;

/**
 * The protected-paths check of an attempt: `null` when it was not run (no list
 * declared, or a stop's close), else a pass with no change or a fail with at
 * least one.
 */
const ProtectedPathsResultSchema = Schema.NullOr(
  Schema.Union(
    Schema.Struct({ result: Schema.Literal("pass"), changes: Schema.Tuple() }),
    Schema.Struct({
      result: Schema.Literal("fail"),
      changes: Schema.NonEmptyArray(ProtectedChangeSchema),
    }),
  ),
);

export type ProtectedPathsResult = Schema.Schema.Type<typeof ProtectedPathsResultSchema>;

const gateAttributionFields = {
  phase: Schema.NonEmptyString,
  steps: Schema.Array(GateStepResultSchema),
  protectedPaths: ProtectedPathsResultSchema,
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
