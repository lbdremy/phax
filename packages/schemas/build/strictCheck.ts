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

const ROOT = "(root)";
const PROPERTY_KEY = /^[a-zA-Z0-9_.-]{1,64}$/;
const LOOKAROUND = /\(\?(?:=|!|<=|<!)/;

const ALLOWED_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "$ref",
  "$defs",
  "definitions",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "description",
  "title",
]);

type Node = Readonly<Record<string, unknown>>;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function join(path: string, segment: string): string {
  return path === ROOT ? segment : `${path}.${segment}`;
}

function codex(path: string, construct: string): StrictViolation {
  return { path, construct, providers: ["codex"] };
}

function claudeCode(path: string, construct: string): StrictViolation {
  return { path, construct, providers: ["claude-code"] };
}

function keywordViolations(node: Node, path: string, isRoot: boolean): StrictViolation[] {
  const found: StrictViolation[] = [];
  let reportedIf = false;
  for (const keyword of Object.keys(node)) {
    switch (keyword) {
      case "oneOf":
      case "allOf":
      case "not":
      case "minLength":
      case "maxLength":
        found.push(codex(path, keyword));
        break;
      case "if":
      case "then":
      case "else":
        if (!reportedIf) found.push(codex(path, "if"));
        reportedIf = true;
        break;
      case "pattern":
        if (typeof node["pattern"] === "string" && LOOKAROUND.test(node["pattern"])) {
          found.push(codex(path, "lookaround pattern"));
        }
        break;
      case "anyOf":
        if (isRoot) found.push(codex(path, "root anyOf"));
        break;
      case "$schema":
        if (!isRoot) found.push(codex(path, `unsupported keyword "${keyword}"`));
        break;
      default:
        if (!ALLOWED_KEYWORDS.has(keyword)) {
          found.push(codex(path, `unsupported keyword "${keyword}"`));
        }
    }
  }
  return found;
}

function objectViolations(node: Node, path: string, isRoot: boolean): StrictViolation[] {
  const found: StrictViolation[] = [];
  const properties = isNode(node["properties"]) ? node["properties"] : undefined;
  const isObject = node["type"] === "object" || properties !== undefined;
  if (isObject && node["additionalProperties"] !== false) found.push(codex(path, "open object"));
  if (properties === undefined) return found;
  const required = Array.isArray(node["required"]) ? node["required"] : [];
  // The root's $schema property is judged by rootViolations, and never sent to Claude Code.
  const keys = Object.keys(properties).filter((key) => !(isRoot && key === "$schema"));
  for (const key of keys) {
    if (!required.includes(key)) found.push(codex(path, `optional key "${key}"`));
  }
  for (const key of keys) {
    if (!PROPERTY_KEY.test(key)) found.push(claudeCode(path, `property key "${key}"`));
  }
  return found;
}

function rootViolations(node: Node): StrictViolation[] {
  if (node["type"] !== "object") return [codex(ROOT, "root not an object")];
  const properties = isNode(node["properties"]) ? node["properties"] : {};
  const required = Array.isArray(node["required"]) ? node["required"] : [];
  const found: StrictViolation[] = [];
  if (!("$schema" in properties) || !required.includes("$schema")) {
    found.push(codex(ROOT, "no $schema property"));
  }
  const stamp = properties["$schema"];
  if ("$schema" in properties && !(isNode(stamp) && typeof stamp["const"] === "string")) {
    found.push(codex("properties.$schema", "$schema not a const"));
  }
  return found;
}

function walk(node: unknown, path: string, isRoot: boolean, found: StrictViolation[]): void {
  if (!isNode(node)) return;
  found.push(...keywordViolations(node, path, isRoot), ...objectViolations(node, path, isRoot));
  const properties = node["properties"];
  if (isNode(properties)) {
    for (const [key, value] of Object.entries(properties)) {
      walk(value, join(path, `properties.${key}`), false, found);
    }
  }
  walk(node["items"], join(path, "items"), false, found);
  const anyOf = node["anyOf"];
  if (Array.isArray(anyOf)) {
    anyOf.forEach((branch, index) =>
      walk(branch, `${join(path, "anyOf")}[${index}]`, false, found),
    );
  }
  for (const table of ["$defs", "definitions"] as const) {
    const entries = node[table];
    if (!isNode(entries)) continue;
    for (const [name, value] of Object.entries(entries)) {
      walk(value, join(path, `${table}.${name}`), false, found);
    }
  }
}

export function strictViolations(schema: unknown): readonly StrictViolation[] {
  if (!isNode(schema)) return [codex(ROOT, "root not an object")];
  const found = rootViolations(schema);
  walk(schema, ROOT, true, found);
  const bytes = new TextEncoder().encode(JSON.stringify(schema)).length;
  if (bytes > INLINE_SCHEMA_BUDGET_BYTES) {
    found.push(claudeCode(ROOT, `inline size above ${INLINE_SCHEMA_BUDGET_BYTES} bytes`));
  }
  return found;
}

export function strictCheckFindings(answer: string, schema: unknown): readonly string[] {
  return strictViolations(schema).map((violation) => {
    const rules = violation.providers.includes("claude-code")
      ? "Claude Code --json-schema"
      : "Codex strict";
    return `✗ ${answer}: ${violation.construct} at ${violation.path} (${rules})`;
  });
}
