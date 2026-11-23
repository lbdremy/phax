// The frozen 0.33.0 shape of `gate-attribution`: the file phax 0.33.0 through
// 0.42.x wrote, `$schema` first, a step of the phase's configured gate or the
// `acceptance` step phax appends at an acceptance pair's gate, and the
// protected-paths result, none of them timed. Unknown keys are ignored.
// Never edit this module: packages/schemas/history.lock.json pins its bytes.
// In phax, only src/schemas/persisted.ts may import it; the schemas package
// lists it as the format's 0.33.0 release.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

const SchemaUrlSchema = Schema.String.check(
  isExportedPattern(
    /^https:\/\/docs\.phax\.run\/schemas\/gate-attribution\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
).pipe(
  Schema.annotate({
    description:
      "The gate-attribution format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/gate-attribution/<X.Y.Z>.json",
  }),
);

const ConfiguredStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: Schema.Literals(["local", "structural", "product"]),
  result: Schema.Literals(["pass", "fail", "refused"]),
});

const AcceptanceStepResultSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  surface: Schema.Literal("acceptance"),
  result: Schema.Literals(["pass", "fail", "refused", "skipped"]),
});

const GateStepResultSchema = Schema.Union([ConfiguredStepResultSchema, AcceptanceStepResultSchema]);

const ProtectedChangeKindSchema = Schema.Literals([
  "created",
  "edited",
  "deleted",
  "renamed",
  "symlink",
  "nested-repository",
]);

const ProtectedChangeSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  kind: ProtectedChangeKindSchema,
  entry: Schema.NonEmptyString,
});

const ProtectedPathsResultSchema = Schema.NullOr(
  Schema.Union([
    Schema.Struct({ result: Schema.Literal("pass"), changes: Schema.Tuple([]) }),
    Schema.Struct({
      result: Schema.Literal("fail"),
      changes: Schema.NonEmptyArray(ProtectedChangeSchema),
    }),
  ]),
);

export const GateAttributionV0_33_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  phase: Schema.NonEmptyString,
  steps: Schema.Array(GateStepResultSchema),
  protectedPaths: ProtectedPathsResultSchema,
});

export type GateAttributionV0_33_0 = Schema.Schema.Type<typeof GateAttributionV0_33_0Schema>;

export const decodeGateAttributionV0_33_0 = Schema.decodeUnknownResult(
  GateAttributionV0_33_0Schema,
  { reportInput: true },
);
