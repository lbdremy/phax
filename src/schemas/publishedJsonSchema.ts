// The one renderer of a format's published JSON Schema, shared by the build
// that writes packages/schemas/json/<format>.schema.json and by the prompts and
// provider flags that hand an answer's schema to a model. Imports only effect.
import { JSONSchema, type Schema } from "effect";

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

/**
 * How a format's decoder treats a key its schema does not name: `error`
 * rejects it, `ignore` accepts and drops it. The JSON Schema follows suit.
 */
export type Excess = "error" | "ignore";

/**
 * `JSONSchema.fromAST` with the format's excess-property strategy, which only
 * `fromAST` takes: draft-07 `$schema`, the root `title`, then `$defs` and the
 * schema's own keys.
 */
export function renderPublishedJsonSchema({
  schema,
  title,
  excess,
}: {
  readonly schema: Schema.Schema.Any;
  readonly title: string;
  readonly excess: Excess;
}): Record<string, unknown> {
  const definitions: Record<string, JSONSchema.JsonSchema7> = {};
  const rendered: Record<string, unknown> = {
    ...JSONSchema.fromAST(schema.ast, {
      definitions,
      target: "jsonSchema7",
      additionalPropertiesStrategy: excess === "ignore" ? "allow" : "strict",
    }),
  };
  const { title: _ownTitle, ...body } = rendered;
  return {
    $schema: DRAFT_07,
    title,
    ...(Object.keys(definitions).length > 0 ? { $defs: definitions } : {}),
    ...body,
  };
}
