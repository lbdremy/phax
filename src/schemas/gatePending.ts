import { Schema } from "effect";
import { CompletionDiagnosticSchema } from "./gateDiagnostics.js";

const PendingDiagnosticSchema = Schema.Struct({
  diagnostic: CompletionDiagnosticSchema,
  openScopes: Schema.NonEmptyArray(Schema.NonEmptyString),
});

const PendingStepSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  pending: Schema.NonEmptyArray(PendingDiagnosticSchema),
});

export const GatePendingDocumentSchema = Schema.Struct({
  closed: Schema.Array(Schema.NonEmptyString),
  steps: Schema.Array(PendingStepSchema),
});

export type GatePendingDocument = Schema.Schema.Type<typeof GatePendingDocumentSchema>;

export const decodeGatePendingDocument = Schema.decodeUnknownEither(GatePendingDocumentSchema);
export const encodeGatePendingDocument = Schema.encodeSync(GatePendingDocumentSchema);
