import { Schema } from "effect";

export const GateDiagnosticSchema = Schema.Struct({
  rule: Schema.NonEmptyString,
  location: Schema.Struct({
    file: Schema.NonEmptyString,
    line: Schema.optionalWith(Schema.Int.pipe(Schema.positive()), { exact: true }),
  }),
  message: Schema.NonEmptyString,
  repair: Schema.NonEmptyString,
});

export type GateDiagnostic = Schema.Schema.Type<typeof GateDiagnosticSchema>;

export const GateDiagnosticsDocumentSchema = Schema.Struct({
  diagnostics: Schema.Array(GateDiagnosticSchema),
});

export type GateDiagnosticsDocument = Schema.Schema.Type<typeof GateDiagnosticsDocumentSchema>;

export const decodeGateDiagnosticsDocument = Schema.decodeUnknownEither(
  GateDiagnosticsDocumentSchema,
);
export const encodeGateDiagnosticsDocument = Schema.encodeSync(GateDiagnosticsDocumentSchema);
