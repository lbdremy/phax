// The frozen 0.26.0 shape of `gate-attribution`: the file phax 0.26.0 through
// 0.30.x wrote, `$schema` first, a step of the phase's configured gate or the
// oracle step phax appends at an oracle pair's gate, and no protected-paths
// result. Unknown keys are ignored.
// Never edit this module: packages/schemas/history.lock.json pins its bytes.
// In phax, only src/schemas/persisted.ts may import it; the schemas package
// lists it as the format's 0.26.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/gate-attribution\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The gate-attribution format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/gate-attribution/<X.Y.Z>.json",
  }),
);

const ConfiguredStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: Schema.Literal("local", "structural", "product"),
  result: Schema.Literal("pass", "fail", "refused"),
});

const OracleStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: Schema.Literal("oracle"),
  result: Schema.Literal("pass", "fail", "refused", "skipped"),
});

const GateStepResultSchema = Schema.Union(ConfiguredStepResultSchema, OracleStepResultSchema);

export const GateAttributionV0_26_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  phase: Schema.NonEmptyString,
  steps: Schema.Array(GateStepResultSchema),
});

export type GateAttributionV0_26_0 = Schema.Schema.Type<typeof GateAttributionV0_26_0Schema>;

export const decodeGateAttributionV0_26_0 = Schema.decodeUnknownEither(
  GateAttributionV0_26_0Schema,
);
