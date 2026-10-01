import { Schema } from "effect";
import { CompletionDiagnosticSchema } from "./gateDiagnostics.js";
import { schemaUrlField } from "./schemaUrl.js";

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

/**
 * An attempt's `.pending.json` as phax writes it: `$schema` first, then the
 * document's fields. Unknown keys are ignored.
 */
export const GatePendingFileSchema = Schema.Struct({
  $schema: schemaUrlField("gate-pending"),
  ...GatePendingDocumentSchema.fields,
});

export type GatePendingFile = Schema.Schema.Type<typeof GatePendingFileSchema>;

export const decodeGatePendingFile = Schema.decodeUnknownEither(GatePendingFileSchema);
export const encodeGatePendingFile = Schema.encodeSync(GatePendingFileSchema);
