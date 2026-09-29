// Frozen: a fix-loop attempt's checks-attempt-NN.pending.json as phax writes
// it, with no version literal — shape v0 (copied from src/schemas/gatePending.ts
// and the completion diagnostic of src/schemas/gateDiagnostics.ts at
// bfb8385e). Unknown keys are ignored, as phax's decoder ignores them.
// Pinned by hash in packages/schemas/history.lock.json — never edit.
// Self-contained: imports only effect, so later changes to phax's
// src/schemas cannot reach it.
import { Schema } from "effect";

const CompletionDiagnosticSchema = Schema.Struct({
  class: Schema.Literal("completion"),
  scopes: Schema.NonEmptyArray(Schema.NonEmptyString),
  rule: Schema.NonEmptyString,
  location: Schema.Struct({
    file: Schema.NonEmptyString,
    line: Schema.optionalWith(Schema.Int.pipe(Schema.positive()), { exact: true }),
  }),
  message: Schema.NonEmptyString,
  repair: Schema.NonEmptyString,
});

const PendingDiagnosticSchema = Schema.Struct({
  diagnostic: CompletionDiagnosticSchema,
  openScopes: Schema.NonEmptyArray(Schema.NonEmptyString),
});

const PendingStepSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  pending: Schema.NonEmptyArray(PendingDiagnosticSchema),
});

export const GatePendingV0Schema = Schema.Struct({
  closed: Schema.Array(Schema.NonEmptyString),
  steps: Schema.Array(PendingStepSchema),
});

export type GatePendingV0 = Schema.Schema.Type<typeof GatePendingV0Schema>;

export const decodeGatePendingV0 = Schema.decodeUnknownEither(GatePendingV0Schema);
