// The frozen 0.17.0 shape of `gate-diagnostics`: the file phax 0.17.0 through
// 0.19.x wrote, `$schema` first and a completion carrying `scopes`. Never edit
// this module: packages/schemas/history.lock.json pins its bytes. phax itself
// never imports it; the schemas package lists it as the format's 0.17.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/gate-diagnostics\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The gate-diagnostics format and the phax release that wrote this file: https://docs.phax.run/schemas/gate-diagnostics/<X.Y.Z>.json",
  }),
);

const GateDiagnosticFields = {
  rule: Schema.NonEmptyString,
  location: Schema.Struct({
    file: Schema.NonEmptyString,
    line: Schema.optionalWith(Schema.Int.pipe(Schema.positive()), { exact: true }),
  }),
  message: Schema.NonEmptyString,
  repair: Schema.NonEmptyString,
};

const InvariantDiagnosticSchema = Schema.Struct({
  class: Schema.Literal("invariant"),
  ...GateDiagnosticFields,
});

const CompletionDiagnosticSchema = Schema.Struct({
  class: Schema.Literal("completion"),
  scopes: Schema.NonEmptyArray(Schema.NonEmptyString),
  ...GateDiagnosticFields,
});

const GateDiagnosticSchema = Schema.Union(InvariantDiagnosticSchema, CompletionDiagnosticSchema);

export const GateDiagnosticsV0_17_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  diagnostics: Schema.Array(GateDiagnosticSchema),
});

export type GateDiagnosticsV0_17_0 = Schema.Schema.Type<typeof GateDiagnosticsV0_17_0Schema>;

export const decodeGateDiagnosticsV0_17_0 = Schema.decodeUnknownEither(
  GateDiagnosticsV0_17_0Schema,
);
