// The strict check's internals: what the walk visits, what it allows, and how
// the inline size is counted. The construct table lives in strictCheck.test.ts.
import { describe, expect, it } from "vitest";
import {
  INLINE_SCHEMA_BUDGET_BYTES,
  strictViolations,
} from "../../../packages/schemas/build/strictCheck.js";

type Node = Record<string, unknown>;

const STAMP = "https://example.test/schemas/walk/1.json";

// A closed root holding the stamp and the given properties, all required.
function root(properties: Node = {}, extra: Node = {}): Node {
  const all: Node = { $schema: { type: "string", const: STAMP }, ...properties };
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: all,
    required: Object.keys(all),
    additionalProperties: false,
    ...extra,
  };
}

const constructs = (schema: Node): string[] => strictViolations(schema).map((v) => v.construct);
const paths = (schema: Node): string[] => strictViolations(schema).map((v) => v.path);

describe("strict check walk", () => {
  it("visits each $defs entry once and never follows a $ref", () => {
    const schema = root(
      {
        a: { $ref: "#/$defs/Bad" },
        b: { $ref: "#/$defs/Bad" },
      },
      { $defs: { Bad: { type: "string", minLength: 1 }, Fine: { type: "string" } } },
    );
    expect(strictViolations(schema)).toEqual([
      { path: "$defs.Bad", construct: "minLength", providers: ["codex"] },
    ]);
  });

  it("allows nullable types, a nested anyOf, minItems, maxItems and numeric bounds", () => {
    const schema = root({
      a: { type: ["string", "null"] },
      b: { anyOf: [{ type: "string" }, { type: "null" }] },
      c: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      d: {
        type: "number",
        minimum: 0,
        maximum: 9,
        exclusiveMinimum: 0,
        exclusiveMaximum: 10,
        multipleOf: 1,
      },
    });
    expect(strictViolations(schema)).toEqual([]);
  });

  it("walks anyOf branches", () => {
    const schema = root({
      note: { anyOf: [{ type: "string" }, { type: "string", maxLength: 3 }] },
    });
    expect(strictViolations(schema)).toEqual([
      { path: "properties.note.anyOf[1]", construct: "maxLength", providers: ["codex"] },
    ]);
  });

  it("reports a then without an if as if", () => {
    const keyword = ["th", "en"].join("");
    const schema = root({ a: { type: "string", [keyword]: { type: "string" } } });
    expect(constructs(schema)).toEqual(["if"]);
  });

  it("checks property keys under every properties, the root $schema excepted", () => {
    const inner: Node = {
      type: "object",
      properties: { "bad key": { type: "string" } },
      required: ["bad key"],
      additionalProperties: false,
    };
    const schema = root({ list: { type: "array", items: inner } });
    expect(strictViolations(schema)).toEqual([
      {
        path: "properties.list.items",
        construct: 'property key "bad key"',
        providers: ["claude-code"],
      },
    ]);
    expect(constructs(root())).toEqual([]);
  });

  it("does not read a $defs name as a property key", () => {
    const schema = root({}, { $defs: { "not a key": { type: "string" } } });
    expect(strictViolations(schema)).toEqual([]);
  });

  it("reads a property named like a keyword as a property", () => {
    expect(
      constructs(root({ pattern: { type: "string" }, minLength: { type: "string" } })),
    ).toEqual([]);
  });
});

describe("strict check inline size", () => {
  function sized(bytes: number): Node {
    const schema = root({}, { description: "" });
    const base = new TextEncoder().encode(JSON.stringify(schema)).length;
    schema["description"] = "x".repeat(bytes - base);
    return schema;
  }

  it("accepts a schema just under the budget and refuses one just over", () => {
    expect(paths(sized(INLINE_SCHEMA_BUDGET_BYTES - 1))).toEqual([]);
    expect(constructs(sized(INLINE_SCHEMA_BUDGET_BYTES + 1))).toEqual([
      `inline size above ${INLINE_SCHEMA_BUDGET_BYTES} bytes`,
    ]);
  });

  it("counts bytes, not characters", () => {
    const schema = root({}, { description: "€".repeat(34_000) });
    expect(JSON.stringify(schema).length).toBeLessThan(INLINE_SCHEMA_BUDGET_BYTES);
    expect(constructs(schema)).toEqual([`inline size above ${INLINE_SCHEMA_BUDGET_BYTES} bytes`]);
  });
});
