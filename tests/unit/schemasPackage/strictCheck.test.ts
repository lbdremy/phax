// Oracles for the strict check (packages/schemas/build/strictCheck.ts): the
// frozen table of JSON Schema constructs outside Codex strict or Claude Code's
// property-key and inline-size rules, each with the one finding the check must
// report. Every test is an expected failure against the stub; phase-02
// implements the check and removes the markers. The fixtures are hand-written
// here: they are what the oracle judges with, so no generator or shared fixture
// is used.
import { describe, expect, it } from "vitest";
import {
  INLINE_SCHEMA_BUDGET_BYTES,
  strictCheckFindings,
  strictViolations,
  type StrictProvider,
} from "../../../packages/schemas/build/strictCheck.js";

const ANSWER = "plan-document";
const STAMP = "https://example.test/schemas/plan-document/1.json";
const ENTRY_GUARANTEE = "properties.entries.items.properties.guarantee";

type Node = Record<string, unknown>;

// The child at a chain of keys: child(s, "properties", "nested").
function child(node: Node, ...keys: readonly string[]): Node {
  let current = node;
  for (const key of keys) current = current[key] as Node;
  return current;
}

// A schema inside Codex strict and Claude Code's key and size rules. The root
// `$schema` property is what Effect renders for an annotated literal.
function conforming(): Node {
  const properties: Node = {
    $schema: { type: "string", enum: [STAMP], description: "The format stamp.", const: STAMP },
    title: { $ref: "#/$defs/NonEmptyString" },
    pattern: { type: "string" },
    guarantee: { type: "string", pattern: "^[\\s\\S]+$" },
    kind: { type: "string", enum: ["spec", "plan"] },
    mode: { type: "string", const: "plan" },
    due: { type: "string", format: "date-time" },
    count: { type: "number", minimum: 0, exclusiveMaximum: 10, multipleOf: 0.5 },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
    entries: {
      type: "array",
      minItems: 2,
      maxItems: 9,
      items: {
        type: "object",
        properties: {
          guarantee: { type: "string", pattern: "^[\\s\\S]+$" },
          line: { $ref: "#/$defs/Line", exclusiveMinimum: 0 },
        },
        required: ["guarantee", "line"],
        additionalProperties: false,
      },
    },
    nested: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  };
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Plan document",
    description: "A plan, as the model answers it.",
    $defs: {
      NonEmptyString: { type: "string", pattern: "^[\\s\\S]+$" },
      Line: { type: "integer" },
    },
    definitions: { Alias: { type: "string" } },
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

// The conforming schema with one change applied.
function mutated(mutate: (schema: Node) => void): () => Node {
  return () => {
    const schema = conforming();
    mutate(schema);
    return schema;
  };
}

function withNestedKey(key: string): () => Node {
  return mutated((schema) => {
    const nested = child(schema, "properties", "nested");
    child(nested, "properties")[key] = { type: "string" };
    (nested["required"] as string[]).push(key);
  });
}

function withEntryPattern(pattern: string): () => Node {
  return mutated((schema) => {
    child(schema, ...ENTRY_GUARANTEE.split("."))["pattern"] = pattern;
  });
}

function withNestedKeyword(keyword: string, value: unknown): () => Node {
  return mutated((schema) => {
    child(schema, "properties", "nested")[keyword] = value;
  });
}

// The conforming schema padded so JSON.stringify(schema) is `bytes` UTF-8 bytes.
function paddedTo(bytes: number): Node {
  const schema = conforming();
  schema["description"] = "";
  const base = new TextEncoder().encode(JSON.stringify(schema)).length;
  schema["description"] = "x".repeat(bytes - base);
  return schema;
}

function rulesOf(providers: readonly StrictProvider[]): string {
  return providers.includes("claude-code") ? "Claude Code --json-schema" : "Codex strict";
}

interface Row {
  readonly name: string;
  readonly construct: string;
  readonly path: string;
  readonly providers: readonly StrictProvider[];
  readonly build: () => Node;
}

const CODEX: readonly StrictProvider[] = ["codex"];
const CLAUDE_CODE: readonly StrictProvider[] = ["claude-code"];

const rows: readonly Row[] = [
  {
    name: "root not an object",
    construct: "root not an object",
    path: "(root)",
    providers: CODEX,
    build: () => ({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "array",
      items: { type: "string" },
    }),
  },
  {
    name: "root anyOf",
    construct: "root anyOf",
    path: "(root)",
    providers: CODEX,
    build: mutated((schema) => {
      schema["anyOf"] = [{ type: "string" }, { type: "null" }];
    }),
  },
  {
    name: "oneOf",
    construct: "oneOf",
    path: "properties.nested",
    providers: CODEX,
    build: withNestedKeyword("oneOf", [{ type: "string" }, { type: "number" }]),
  },
  {
    name: "allOf",
    construct: "allOf",
    path: "properties.nested",
    providers: CODEX,
    build: withNestedKeyword("allOf", [{ type: "object" }]),
  },
  {
    name: "not",
    construct: "not",
    path: "properties.nested",
    providers: CODEX,
    build: withNestedKeyword("not", { type: "string" }),
  },
  {
    name: "if",
    construct: "if",
    path: "properties.nested",
    providers: CODEX,
    build: withNestedKeyword("if", { properties: { value: { const: "a" } } }),
  },
  {
    name: "then alone is reported as if",
    construct: "if",
    path: "properties.nested",
    providers: CODEX,
    build: withNestedKeyword("then", { required: ["value"] }),
  },
  {
    name: "else alone is reported as if",
    construct: "if",
    path: "properties.nested",
    providers: CODEX,
    build: withNestedKeyword("else", { required: ["value"] }),
  },
  ...["(?=", "(?!", "(?<=", "(?<!"].map(
    (lookaround): Row => ({
      name: `lookaround pattern ${lookaround}`,
      construct: "lookaround pattern",
      path: ENTRY_GUARANTEE,
      providers: CODEX,
      build: withEntryPattern(`^${lookaround}\\s)[\\s\\S]*$`),
    }),
  ),
  {
    name: "lookaround pattern in a $defs entry, reported once under $defs",
    construct: "lookaround pattern",
    path: "$defs.NonEmptyString",
    providers: CODEX,
    build: mutated((schema) => {
      child(schema, "$defs", "NonEmptyString")["pattern"] = "^(?!\\s)[\\s\\S]*$";
    }),
  },
  {
    name: "minLength in a definitions entry",
    construct: "minLength",
    path: "definitions.Alias",
    providers: CODEX,
    build: mutated((schema) => {
      child(schema, "definitions", "Alias")["minLength"] = 1;
    }),
  },
  {
    name: "minLength",
    construct: "minLength",
    path: ENTRY_GUARANTEE,
    providers: CODEX,
    build: mutated((schema) => {
      child(schema, ...ENTRY_GUARANTEE.split("."))["minLength"] = 1;
    }),
  },
  {
    name: "maxLength",
    construct: "maxLength",
    path: "properties.guarantee",
    providers: CODEX,
    build: mutated((schema) => {
      child(schema, "properties", "guarantee")["maxLength"] = 200;
    }),
  },
  {
    name: "open object, additionalProperties absent",
    construct: "open object",
    path: "properties.nested",
    providers: CODEX,
    build: mutated((schema) => {
      delete child(schema, "properties", "nested")["additionalProperties"];
    }),
  },
  {
    name: "open object, additionalProperties true",
    construct: "open object",
    path: "properties.nested",
    providers: CODEX,
    build: mutated((schema) => {
      child(schema, "properties", "nested")["additionalProperties"] = true;
    }),
  },
  {
    name: "optional key",
    construct: 'optional key "extra"',
    path: "properties.nested",
    providers: CODEX,
    build: mutated((schema) => {
      child(schema, "properties", "nested", "properties")["extra"] = { type: "string" };
    }),
  },
  {
    name: "no $schema property, none declared",
    construct: "no $schema property",
    path: "(root)",
    providers: CODEX,
    build: mutated((schema) => {
      delete child(schema, "properties")["$schema"];
      schema["required"] = (schema["required"] as string[]).filter((key) => key !== "$schema");
    }),
  },
  {
    name: "no $schema property, declared but not required",
    construct: "no $schema property",
    path: "(root)",
    providers: CODEX,
    build: mutated((schema) => {
      schema["required"] = (schema["required"] as string[]).filter((key) => key !== "$schema");
    }),
  },
  {
    name: "$schema not a const, no const",
    construct: "$schema not a const",
    path: "properties.$schema",
    providers: CODEX,
    build: mutated((schema) => {
      child(schema, "properties")["$schema"] = { type: "string" };
    }),
  },
  {
    name: "$schema not a const, const not a string",
    construct: "$schema not a const",
    path: "properties.$schema",
    providers: CODEX,
    build: mutated((schema) => {
      child(schema, "properties")["$schema"] = { const: 1 };
    }),
  },
  {
    name: "property key $id",
    construct: 'property key "$id"',
    path: "properties.nested",
    providers: CLAUDE_CODE,
    build: withNestedKey("$id"),
  },
  {
    name: "property key with a space",
    construct: 'property key "a b"',
    path: "properties.nested",
    providers: CLAUDE_CODE,
    build: withNestedKey("a b"),
  },
  {
    name: "property key above 64 characters",
    construct: `property key "${"k".repeat(65)}"`,
    path: "properties.nested",
    providers: CLAUDE_CODE,
    build: withNestedKey("k".repeat(65)),
  },
  {
    name: "unsupported keyword patternProperties",
    construct: 'unsupported keyword "patternProperties"',
    path: "properties.nested",
    providers: CODEX,
    build: withNestedKeyword("patternProperties", { "^x": { type: "string" } }),
  },
  {
    name: "unsupported keyword uniqueItems",
    construct: 'unsupported keyword "uniqueItems"',
    path: "properties.entries",
    providers: CODEX,
    build: mutated((schema) => {
      child(schema, "properties", "entries")["uniqueItems"] = true;
    }),
  },
  {
    name: "unsupported keyword dependencies",
    construct: 'unsupported keyword "dependencies"',
    path: "properties.nested",
    providers: CODEX,
    build: withNestedKeyword("dependencies", { value: ["value"] }),
  },
  {
    name: "inline size above the budget",
    construct: `inline size above ${INLINE_SCHEMA_BUDGET_BYTES} bytes`,
    path: "(root)",
    providers: CLAUDE_CODE,
    build: mutated((schema) => {
      schema["description"] = "x".repeat(INLINE_SCHEMA_BUDGET_BYTES);
    }),
  },
  {
    name: "inline size counts UTF-8 bytes, not characters",
    construct: `inline size above ${INLINE_SCHEMA_BUDGET_BYTES} bytes`,
    path: "(root)",
    providers: CLAUDE_CODE,
    build: mutated((schema) => {
      schema["description"] = "€".repeat(40_000);
    }),
  },
];

describe("strict check oracles", () => {
  // Oracle 1: a conforming schema yields nothing.
  it.fails("yields no violation and no finding for a conforming schema", () => {
    const schema = conforming();
    expect(strictViolations(schema)).toEqual([]);
    expect(strictCheckFindings(ANSWER, schema)).toEqual([]);
  });

  it.fails("accepts a schema of exactly the inline budget", () => {
    const schema = paddedTo(INLINE_SCHEMA_BUDGET_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(schema)).length).toBe(
      INLINE_SCHEMA_BUDGET_BYTES,
    );
    expect(strictViolations(schema)).toEqual([]);
    expect(strictCheckFindings(ANSWER, schema)).toEqual([]);
  });

  it.fails("refuses a schema one byte above the inline budget", () => {
    const schema = paddedTo(INLINE_SCHEMA_BUDGET_BYTES + 1);
    expect(strictViolations(schema)).toEqual([
      {
        path: "(root)",
        construct: `inline size above ${INLINE_SCHEMA_BUDGET_BYTES} bytes`,
        providers: CLAUDE_CODE,
      },
    ]);
  });

  // Oracle 2: each construct yields exactly one violation and one finding.
  it.fails.each(rows)("$name yields one violation and one finding", (row) => {
    const schema = row.build();
    expect(strictViolations(schema)).toEqual([
      { path: row.path, construct: row.construct, providers: row.providers },
    ]);
    expect(strictCheckFindings(ANSWER, schema)).toEqual([
      `✗ ${ANSWER}: ${row.construct} at ${row.path} (${rulesOf(row.providers)})`,
    ]);
  });

  // Oracle 3: the acceptance case, the lookahead the guarantee pattern holds today.
  it.fails("names a lookahead guarantee pattern as a lookaround pattern", () => {
    const schema = mutated((s) => {
      child(s, "properties", "guarantee")["pattern"] = "^(?!\\s)[\\s\\S]*\\S$";
    })();
    expect(strictCheckFindings(ANSWER, schema)).toEqual([
      "✗ plan-document: lookaround pattern at properties.guarantee (Codex strict)",
    ]);
  });

  // Oracle 4: one finding per violation, root first, then properties in key
  // order, depth first: the deep entries violation precedes the shallower
  // nested one, which a breadth-first walk would reverse.
  it.fails("reports several violations in walk order", () => {
    const schema = mutated((s) => {
      s["allOf"] = [{ type: "object" }];
      child(s, ...ENTRY_GUARANTEE.split("."))["pattern"] = "^(?=a)[\\s\\S]*$";
      const nested = child(s, "properties", "nested");
      child(nested, "properties")["$id"] = { type: "string" };
      (nested["required"] as string[]).push("$id");
    })();
    expect(strictViolations(schema).map((v) => [v.construct, v.path])).toEqual([
      ["allOf", "(root)"],
      ["lookaround pattern", ENTRY_GUARANTEE],
      ['property key "$id"', "properties.nested"],
    ]);
    expect(strictCheckFindings(ANSWER, schema)).toEqual([
      "✗ plan-document: allOf at (root) (Codex strict)",
      `✗ plan-document: lookaround pattern at ${ENTRY_GUARANTEE} (Codex strict)`,
      '✗ plan-document: property key "$id" at properties.nested (Claude Code --json-schema)',
    ]);
  });
});
