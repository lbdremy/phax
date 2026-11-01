// The frozen 0.31.0 shape of `gate-attribution`: the file phax 0.31.0 through
// 0.32.x wrote, `$schema` first, a step of the phase's configured gate or the
// `oracle` step phax appends at an oracle pair's gate, and the protected-paths
// result. Unknown keys are ignored.
// Never edit this module: packages/schemas/history.lock.json pins its bytes.
// In phax, only src/schemas/persisted.ts may import it; the schemas package
// lists it as the format's 0.31.0 release.
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

const ProtectedChangeKindSchema = Schema.Literal(
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

const ProtectedPathsResultSchema = Schema.NullOr(
  Schema.Union(
    Schema.Struct({ result: Schema.Literal("pass"), changes: Schema.Tuple() }),
    Schema.Struct({
      result: Schema.Literal("fail"),
      changes: Schema.NonEmptyArray(ProtectedChangeSchema),
    }),
  ),
);

export const GateAttributionV0_31_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  phase: Schema.NonEmptyString,
  steps: Schema.Array(GateStepResultSchema),
  protectedPaths: ProtectedPathsResultSchema,
});

export type GateAttributionV0_31_0 = Schema.Schema.Type<typeof GateAttributionV0_31_0Schema>;

export const decodeGateAttributionV0_31_0 = Schema.decodeUnknownEither(
  GateAttributionV0_31_0Schema,
);
