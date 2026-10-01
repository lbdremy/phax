// The frozen pre-schema shape of `gate-diagnostics`: exactly what phax wrote
// before it wrote `$schema`. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package re-exports its
// schema and type.
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

export const GateDiagnosticsPreSchemaSchema = Schema.Struct({
  diagnostics: Schema.Array(GateDiagnosticSchema),
});

export type GateDiagnosticsPreSchema = Schema.Schema.Type<typeof GateDiagnosticsPreSchemaSchema>;

export const decodeGateDiagnosticsPreSchema = Schema.decodeUnknownEither(
  GateDiagnosticsPreSchemaSchema,
);
