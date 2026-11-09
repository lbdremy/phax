// A transformation that fails to decode is named by what it decodes into, in phax's words:
// not by the schema's identifier (`NumberFromString`) and not by Effect's reason
// (`Unable to decode "x" into a number`). One that decodes into anything (`parseJson`)
// keeps the label of its input.
import { Result, ParseResult, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { firstRefusal } from "../../../../src/schemas/refusal/adapter.js";
import { refusalMessage } from "../../../../src/schemas/refusal/render.js";

function refused<A, I>(schema: Schema.Schema<A, I, never>, input: unknown): ParseResult.ParseError {
  const decoded = Schema.decodeUnknownResult(schema)(input);
  if (Result.isSuccess(decoded)) throw new Error(`expected a refusal of ${JSON.stringify(input)}`);
  return decoded.left;
}

describe("a transformation that fails to decode", () => {
  it.each([
    ["NumberFromString given a word", Schema.NumberFromString, "x", 'Expected number, actual "x"'],
    ["BigInt given a decimal", Schema.BigInt, "1.5", 'Expected bigint, actual "1.5"'],
    ["parseJson given broken JSON", Schema.parseJson(), "{", 'Expected string, actual "{"'],
  ] as const)("%s", (_name, schema, input, line) => {
    const first = firstRefusal(refused(schema as Schema.Schema<unknown, unknown, never>, input));
    expect(first?.kind).toBe("invalid-type");
    expect(first === undefined ? undefined : refusalMessage(first)).toBe(line);
  });

  it("keeps its input's label when the input itself is wrong", () => {
    const first = firstRefusal(refused(Schema.NumberFromString, 3));
    expect(first === undefined ? undefined : refusalMessage(first)).toBe(
      "Expected string, actual 3",
    );
  });

  it("refuses at the field that holds it", () => {
    const first = firstRefusal(refused(Schema.Struct({ n: Schema.NumberFromString }), { n: "x" }));
    expect(first).toMatchObject({ kind: "invalid-type", path: ["n"], expected: "number" });
  });
});
