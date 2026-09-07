import { Schema } from "effect";

const GateDiagnosticFields = {
  rule: Schema.NonEmptyString,
  location: Schema.Struct({
    file: Schema.NonEmptyString,
    line: Schema.optionalWith(Schema.Int.pipe(Schema.positive()), { exact: true }),
  }),
  message: Schema.NonEmptyString,
  repair: Schema.NonEmptyString,
};

export const InvariantDiagnosticSchema = Schema.Struct({
  class: Schema.Literal("invariant"),
  ...GateDiagnosticFields,
});

export type InvariantDiagnostic = Schema.Schema.Type<typeof InvariantDiagnosticSchema>;

export const CompletionDiagnosticSchema = Schema.Struct({
  class: Schema.Literal("completion"),
  scopes: Schema.NonEmptyArray(Schema.NonEmptyString),
  ...GateDiagnosticFields,
});

export type CompletionDiagnostic = Schema.Schema.Type<typeof CompletionDiagnosticSchema>;

export const GateDiagnosticSchema = Schema.Union(
  InvariantDiagnosticSchema,
  CompletionDiagnosticSchema,
);

export type GateDiagnostic = Schema.Schema.Type<typeof GateDiagnosticSchema>;

export const GateDiagnosticsDocumentSchema = Schema.Struct({
  diagnostics: Schema.Array(GateDiagnosticSchema),
});

export type GateDiagnosticsDocument = Schema.Schema.Type<typeof GateDiagnosticsDocumentSchema>;

export const decodeGateDiagnosticsDocument = Schema.decodeUnknownEither(
  GateDiagnosticsDocumentSchema,
);
export const encodeGateDiagnosticsDocument = Schema.encodeSync(GateDiagnosticsDocumentSchema);
