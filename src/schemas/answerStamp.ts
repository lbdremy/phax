// The `$schema` field of an answer format: a const naming the format at its
// current stamp, the first key of every answer a provider returns. Kept apart
// from answerSchemas.ts, which registers the answers and so imports their
// schemas: the schemas need this field, and one module holding both would be an
// import cycle. Imports only effect, ./schemaUrl.js and ./release.js.
import { Schema } from "effect";
import { CURRENT_STAMPS } from "./release.js";
import { schemaUrl, type FormatId } from "./schemaUrl.js";

/**
 * The required `$schema` of an answer: exactly the URL of `formatId` at its
 * current stamp. It renders as `{ type, enum, description, const }`, a shape
 * both providers' strict modes accept.
 */
export function answerSchemaUrlField(formatId: FormatId) {
  const url = schemaUrl(formatId, CURRENT_STAMPS[formatId]);
  return Schema.Literal(url).annotations({
    jsonSchema: { const: url },
    description: `The ${formatId} format's shape, exactly: ${url}`,
  });
}
