// Frozen: a fix-loop attempt's checks-attempt-NN.diagnostics.json as phax
// writes it, with no version literal — shape v0 (copied from
// src/schemas/gateDiagnostics.ts at bfb8385e). Unknown keys are ignored, as
// phax's decoder ignores them.
// Pinned by hash in packages/schemas/history.lock.json — never edit.
// Self-contained: imports only effect, so later changes to phax's
// src/schemas cannot reach it.
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

export const GateDiagnosticsV0Schema = Schema.Struct({
  diagnostics: Schema.Array(GateDiagnosticSchema),
});

export type GateDiagnosticsV0 = Schema.Schema.Type<typeof GateDiagnosticsV0Schema>;

export const decodeGateDiagnosticsV0 = Schema.decodeUnknownEither(GateDiagnosticsV0Schema);
