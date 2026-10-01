// The frozen pre-schema shape of `gate-pending`: exactly what phax wrote
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

const CompletionDiagnosticSchema = Schema.Struct({
  class: Schema.Literal("completion"),
  scopes: Schema.NonEmptyArray(Schema.NonEmptyString),
  ...GateDiagnosticFields,
});

const PendingDiagnosticSchema = Schema.Struct({
  diagnostic: CompletionDiagnosticSchema,
  openScopes: Schema.NonEmptyArray(Schema.NonEmptyString),
});

const PendingStepSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  pending: Schema.NonEmptyArray(PendingDiagnosticSchema),
});

export const GatePendingPreSchemaSchema = Schema.Struct({
  closed: Schema.Array(Schema.NonEmptyString),
  steps: Schema.Array(PendingStepSchema),
});

export type GatePendingPreSchema = Schema.Schema.Type<typeof GatePendingPreSchemaSchema>;

export const decodeGatePendingPreSchema = Schema.decodeUnknownEither(GatePendingPreSchemaSchema);
