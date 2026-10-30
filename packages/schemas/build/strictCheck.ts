// The strict check: a pure function from a JSON Schema to the constructs a
// provider's native structured output would refuse. No I/O, no runtime imports.
//
// It encodes, locally because tests stay offline, Codex strict (OpenAI strict
// structured outputs) and two Claude Code rules: the inline-size budget, and
// property keys matching ^[a-zA-Z0-9_.-]{1,64}$. The Claude Code rules come from
// the 2026-10-30 probe of Claude Code 2.1.314: `--json-schema` accepted and
// enforced `minItems: 2`, `exclusiveMinimum`, `minLength` and `pattern`, and
// refused any other property key with an API 400. The root `$schema` property is
// exempt from the key rule: Claude Code never receives it (phax removes it and
// sets the stamp itself).
//
// The walk visits the root, every `properties.<key>`, `items`, every `anyOf[i]`,
// and every `$defs.<name>` and `definitions.<name>`. A `$ref` is never followed;
// its target is walked once under `$defs`. A property name is never read as a
// keyword (first-reading has a property named `pattern`). A path is dotted
// keywords from the root, e.g. `properties.phases.items.properties.oracle` or
// `$defs.NonEmptyString`; the root itself is `(root)`.
//
// Allowed keywords: type, properties, required, additionalProperties (only
// false), items, enum, const, anyOf (not at the root), $ref, $defs, definitions,
// pattern (without lookaround), format, minItems, maxItems, minimum, maximum,
// exclusiveMinimum, exclusiveMaximum, multipleOf, description, title, and
// `$schema` only as the root's draft keyword.
//
// Construct names, exact:
//   root not an object
//   root anyOf
//   oneOf | allOf | not
//   if                       (a then or else is also reported as `if`)
//   lookaround pattern       (a pattern holding (?=, (?!, (?<= or (?<!)
//   minLength | maxLength
//   open object              (type object or properties, additionalProperties not false)
//   optional key "<name>"    (a property missing from required)
//   no $schema property      (the root has none, or does not require it)
//   $schema not a const      (the root's $schema property carries no string const;
//                             type: "string", an enum holding that same single
//                             value, description and title are allowed beside it,
//                             since Effect renders an annotated literal as
//                             { type, enum, description, const })
//   property key "<name>"    (a key under any properties outside the key pattern;
//                             the root's $schema property is exempt)
//   unsupported keyword "<k>" (any other keyword: patternProperties, uniqueItems, ...)
//   inline size above 100000 bytes (UTF-8 length of JSON.stringify(schema))
//
// `providers` is ["claude-code"] for the property key and the inline size, and
// ["codex"] for everything else.
//
// A finding is one line per violation, in walk order (root first, then
// properties in key order, depth first):
//   ✗ <answer>: <construct> at <path> (<rules>)
// where <rules> is `Codex strict`, or `Claude Code --json-schema` for the
// property key and the inline size.

export type StrictProvider = "codex" | "claude-code";

export interface StrictViolation {
  readonly path: string;
  readonly construct: string;
  readonly providers: readonly StrictProvider[];
}

export const INLINE_SCHEMA_BUDGET_BYTES = 100_000;

export function strictViolations(_schema: unknown): readonly StrictViolation[] {
  throw new Error("strictCheck: not implemented");
}

export function strictCheckFindings(_answer: string, _schema: unknown): readonly string[] {
  throw new Error("strictCheck: not implemented");
}
