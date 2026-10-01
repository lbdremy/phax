import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

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

// The document a gate step prints on stdout: decoded with this contract, never through the bridge.
export const decodeGateDiagnosticsDocument = Schema.decodeUnknownEither(
  GateDiagnosticsDocumentSchema,
);

/**
 * An attempt's `.diagnostics.json` as phax writes it: `$schema` first, then the
 * stdout contract's fields. Unknown keys are ignored.
 */
export const GateDiagnosticsFileSchema = Schema.Struct({
  $schema: schemaUrlField("gate-diagnostics"),
  ...GateDiagnosticsDocumentSchema.fields,
});

export type GateDiagnosticsFile = Schema.Schema.Type<typeof GateDiagnosticsFileSchema>;

export const decodeGateDiagnosticsFile = Schema.decodeUnknownEither(GateDiagnosticsFileSchema);
export const encodeGateDiagnosticsFile = Schema.encodeSync(GateDiagnosticsFileSchema);
// The stdout contract, without `$schema`: the pre-schema file shape.
export const encodeGateDiagnosticsDocument = Schema.encodeSync(GateDiagnosticsDocumentSchema);
