// The frozen 0.21.0 shape of `gate-attribution`: the file phax 0.21.x through
// 0.26.x wrote, `$schema` first, a step surface of local, structural or
// product and a step result of pass, fail or refused.
// Never edit this module: packages/schemas/history.lock.json pins its bytes.
// phax itself never imports it; the schemas package lists it as the format's
// 0.21.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/gate-attribution\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The gate-attribution format and the phax release that wrote this file: https://docs.phax.run/schemas/gate-attribution/<X.Y.Z>.json",
  }),
);

const SurfaceSchema = Schema.Literal("local", "structural", "product");

const GateStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: SurfaceSchema,
  result: Schema.Literal("pass", "fail", "refused"),
});

export const GateAttributionV0_21_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  phase: Schema.NonEmptyString,
  steps: Schema.Array(GateStepResultSchema),
});

export type GateAttributionV0_21_0 = Schema.Schema.Type<typeof GateAttributionV0_21_0Schema>;

export const decodeGateAttributionV0_21_0 = Schema.decodeUnknownEither(
  GateAttributionV0_21_0Schema,
);
