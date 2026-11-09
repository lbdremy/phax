// A transformation that fails to decode is named by what it decodes into, in phax's words:
// not by the schema's identifier (`NumberFromString`) and not by Effect's reason
// (`Unable to decode "x" into a number`). One that decodes into anything (`parseJson`)
// keeps the label of its input.
import { Effect, Number, Option, Result, Schema, SchemaGetter, SchemaIssue } from "effect";
import { describe, expect, it } from "vitest";
import { firstRefusal } from "../../../../src/schemas/refusal/adapter.js";
import { refusalMessage } from "../../../../src/schemas/refusal/render.js";

// Effect 3's `NumberFromString`, which refuses a string that is not a number (Effect 4's
// decodes it to NaN): the reference's string-to-number transformation.
const NumberFromString = Schema.String.pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transformEffect((s: string) =>
      Option.match(Number.parse(s), {
        onNone: () => Effect.fail(new SchemaIssue.InvalidValue()),
        onSome: Effect.succeed,
      }),
    ),
    encode: SchemaGetter.String(),
  }),
);

function refused<A, I>(schema: Schema.Codec<A, I>, input: unknown): Schema.SchemaError {
  const decoded = Schema.decodeUnknownResult(schema, { reportInput: true })(input);
  if (Result.isSuccess(decoded)) throw new Error(`expected a refusal of ${JSON.stringify(input)}`);
  return decoded.left;
}

describe("a transformation that fails to decode", () => {
  it.each([
    ["NumberFromString given a word", NumberFromString, "x", 'Expected number, actual "x"'],
    ["BigInt given a decimal", Schema.BigIntFromString, "1.5", 'Expected bigint, actual "1.5"'],
    [
      "parseJson given broken JSON",
      Schema.fromJsonString(Schema.Unknown),
      "{",
      'Expected string, actual "{"',
    ],
  ] as const)("%s", (_name, schema, input, line) => {
    const first = firstRefusal(refused<unknown, string>(schema, input));
    expect(first?.kind).toBe("invalid-type");
    expect(first === undefined ? undefined : refusalMessage(first)).toBe(line);
  });

  it("keeps its input's label when the input itself is wrong", () => {
    const first = firstRefusal(refused(NumberFromString, 3));
    expect(first === undefined ? undefined : refusalMessage(first)).toBe(
      "Expected string, actual 3",
    );
  });

  it("refuses at the field that holds it", () => {
    const first = firstRefusal(refused(Schema.Struct({ n: NumberFromString }), { n: "x" }));
    expect(first).toMatchObject({ kind: "invalid-type", path: ["n"], expected: "number" });
  });
});
