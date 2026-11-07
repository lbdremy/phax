// phax's Effect 4 codemod reads the vendored v3-to-v4.md as data: each entry keeps the
// line it sits on. These lines are the ones the rules and the report cite.
import { describe, expect, it } from "vitest";
import { loadReference, parseReference } from "../../../scripts/effect4-codemod/reference.js";

const reference = loadReference();

describe("effect4 codemod reference", () => {
  it("places a Removed Modules entry and its Import Map line", () => {
    expect(reference.entryOf("effect/Either")).toEqual({
      v3Symbol: "effect/Either",
      line: 689,
      section: "removed-modules",
      module: null,
      targets: ["effect/Result"],
    });
    expect(reference.entries).toContainEqual({
      v3Symbol: "effect/Either",
      line: 22,
      section: "import-map",
      module: null,
      targets: ["effect/Result"],
    });
    expect(reference.entryOf("effect/ParseResult")?.targets).toEqual([
      "effect/SchemaIssue",
      "effect/SchemaParser",
    ]);
  });

  it("places an API entry under its module heading", () => {
    expect(reference.entryOf("Effect.catchAll")).toEqual({
      v3Symbol: "Effect.catchAll",
      line: 10003,
      section: "api",
      module: "effect/Effect",
      targets: ["Effect.catch"],
    });
  });

  it("places a -> none entry", () => {
    expect(reference.entryOf("Context.ReferenceTypeId")).toEqual({
      v3Symbol: "Context.ReferenceTypeId",
      line: 9637,
      section: "api",
      module: "effect/Context",
      targets: ["none"],
    });
    expect(reference.movedSymbols.has("Context.ReferenceTypeId")).toBe(true);
  });

  it("places a #### heading with its replacement", () => {
    expect(reference.entryOf("ParseResult.ArrayFormatter")).toEqual({
      v3Symbol: "ParseResult.ArrayFormatter",
      line: 13066,
      section: "api",
      module: "effect/ParseResult",
      targets: ["SchemaIssue.makeFormatterStandardSchemaV1"],
    });
  });

  it("counts a symbol as moved only when its entry maps it elsewhere", () => {
    expect(reference.movedSymbols.has("Either.right")).toBe(true);
    expect(reference.movedSymbols.has("ParseResult.ParseError")).toBe(true);
    expect(reference.lineOf("ParseResult.ParseError")).toBe(13090);
    expect(reference.movedSymbols.has("Effect.Effect")).toBe(false);
    expect(reference.movedSymbols.has("effect/Effect")).toBe(false);
    expect(reference.lineOf("Effect.notAnEffectSymbol")).toBeNull();
  });

  it("knows the v3 effect modules and the v4-only ones", () => {
    expect(reference.effectModules.has("Either")).toBe(true);
    expect(reference.effectModules.has("ParseResult")).toBe(true);
    expect(reference.effectModules.has("Result")).toBe(false);
    expect(reference.v4OnlyModules.has("effect/Filter")).toBe(true);
  });

  it("ignores list-shaped lines inside a fenced example", () => {
    const parsed = parseReference(
      [
        "## API Reference",
        "",
        "### `effect/Either`",
        "",
        "```ts",
        "- `Either.fake` -> `x`",
        "```",
        "",
      ].join("\n"),
    );
    expect(parsed.entries).toEqual([]);
  });
});
