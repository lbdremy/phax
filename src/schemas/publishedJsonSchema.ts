// The renderer of a format's JSON Schema as Effect 4 generates it, shared by
// the build (packages/schemas/build/jsonSchemas.ts) and the schemas check.
// Imports only effect and ./schemaUrl.ts, whose `draft07Document` is the one
// call into Effect's generator.
import { JsonSchema, type Schema } from "effect";
import { draft07Document, type Draft07Document, type Excess } from "./schemaUrl.js";

export type { Excess };

/**
 * A format's generated JSON Schema: the draft-07 `$schema`, the root `title`,
 * then the schema's own keys and its `$defs` when there are any.
 */
export function renderPublishedJsonSchema({
  schema,
  title,
  excess,
}: {
  readonly schema: Schema.Top;
  readonly title: string;
  readonly excess: Excess;
}): Record<string, unknown> {
  const document: Draft07Document = draft07Document(schema, excess);
  const { title: _ownTitle, ...body } = document.schema;
  return {
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_07,
    title,
    ...body,
    ...(Object.keys(document.defs).length > 0 ? { $defs: document.defs } : {}),
  };
}
