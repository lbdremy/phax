import { Either, ParseResult, Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import { describe, expect, it } from "vitest";
import { firstRefusal, refusalsOf } from "../../../../src/schemas/refusal/adapter.js";
import type { Refusal } from "../../../../src/schemas/refusal/model.js";

// Acceptance tests for the Effect 3 adapter: a decode failure becomes phax's
// refusal values. Every label that is not a deliberate move equals the text
// Effect 3's ArrayFormatter message carries for the same input (read on effect
// 3.21.2). The deliberate moves are marked `move:` with Effect 3's words.

// The decode failure of `input`. Thrown at load, not inside a test, when the
// schema accepts the input, so an `it.fails` test can never pass on it.
function refused<A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown,
  options?: ParseOptions,
): ParseResult.ParseError {
  const decoded = Schema.decodeUnknownEither(schema, options)(input);
  if (Either.isRight(decoded)) throw new Error(`expected a refusal of ${JSON.stringify(input)}`);
  return decoded.left;
}

class Phase extends Schema.Class<Phase>("Phase")({ id: Schema.String }) {}

const cases: ReadonlyArray<{
  readonly name: string;
  readonly error: ParseResult.ParseError;
  readonly refusals: ReadonlyArray<Refusal>;
}> = [
  {
    // Effect 3: `is missing`.
    name: "a missing key",
    error: refused(Schema.Struct({ a: Schema.String }), {}),
    refusals: [{ kind: "missing", path: ["a"] }],
  },
  {
    // Effect 3: `is unexpected, expected: "a" | "b"`.
    name: "an excess key",
    error: refused(
      Schema.Struct({ a: Schema.String, b: Schema.Number }),
      { a: "x", b: 1, c: 2 },
      { onExcessProperty: "error" },
    ),
    refusals: [{ kind: "unexpected", path: ["c"], expected: '"a" | "b"' }],
  },
  {
    // move: Effect 3 `Expected { readonly a: string }, actual null`.
    name: "a struct given null",
    error: refused(Schema.Struct({ a: Schema.String }), null),
    refusals: [
      { kind: "invalid-type", path: [], expected: "an object", actual: null, message: null },
    ],
  },
  {
    // move: Effect 3 `Expected ReadonlyArray<string>, actual 1`.
    name: "an array given a number",
    error: refused(Schema.Array(Schema.String), 1),
    refusals: [{ kind: "invalid-type", path: [], expected: "an array", actual: 1, message: null }],
  },
  {
    // move: Effect 3 `Expected readonly [string, ...string[]], actual 1`. A tuple with a rest
    // element is an array to its reader.
    name: "a non-empty array given a number",
    error: refused(Schema.NonEmptyArray(Schema.String), 1),
    refusals: [{ kind: "invalid-type", path: [], expected: "an array", actual: 1, message: null }],
  },
  {
    // move: Effect 3 `Expected readonly [string, number], actual {"a":1}`.
    name: "a tuple given an object",
    error: refused(Schema.Tuple(Schema.String, Schema.Number), { a: 1 }),
    refusals: [
      { kind: "invalid-type", path: [], expected: "a tuple", actual: { a: 1 }, message: null },
    ],
  },
  {
    // Effect 3: `Expected "a", actual "b"`.
    name: "a literal given another string",
    error: refused(Schema.Literal("a"), "b"),
    refusals: [{ kind: "invalid-value", path: [], expected: '"a"', actual: "b", message: null }],
  },
  {
    // move: Effect 3 prints two issues, `Expected "a", actual "c"` and
    // `Expected "b", actual "c"`; phax merges them into one, without a prefix.
    name: "a literal union",
    error: refused(Schema.Literal("a", "b"), "c"),
    refusals: [
      { kind: "invalid-value", path: [], expected: '"a" | "b"', actual: "c", message: null },
    ],
  },
  {
    // move: Effect 3 prints `Expected { readonly a: string }, actual 1` and
    // `Expected null, actual 1`.
    name: "a union of a struct and null given a number",
    error: refused(Schema.Union(Schema.Struct({ a: Schema.String }), Schema.Null), 1),
    refusals: [
      {
        kind: "invalid-type",
        path: [],
        expected: "one of an object | null",
        actual: 1,
        message: null,
      },
    ],
  },
  {
    // move: Effect 3 prints `Expected { readonly a: string }, actual 1` and
    // `Expected { readonly b: number }, actual 1`; both members are `an object`.
    name: "a union of two struct shapes given a number",
    error: refused(
      Schema.Union(Schema.Struct({ a: Schema.String }), Schema.Struct({ b: Schema.Number })),
      1,
    ),
    refusals: [{ kind: "invalid-type", path: [], expected: "an object", actual: 1, message: null }],
  },
  {
    // move: Effect 3 prints the deeper `a: Expected string, actual 1` and the
    // shallow `Expected null, actual {"a":1}`; only the deeper one stays.
    name: "a union where one member got deeper",
    error: refused(Schema.Union(Schema.Struct({ a: Schema.String }), Schema.Null), { a: 1 }),
    refusals: [{ kind: "invalid-type", path: ["a"], expected: "string", actual: 1, message: null }],
  },
  {
    // move: Effect 3 `Expected { readonly a: string }, actual null`.
    name: "a struct behind a transformation given null",
    error: refused(
      Schema.transform(Schema.Struct({ a: Schema.String }), Schema.Struct({ b: Schema.String }), {
        strict: true,
        decode: ({ a }) => ({ b: a }),
        encode: ({ b }) => ({ a: b }),
      }),
      null,
    ),
    refusals: [
      { kind: "invalid-type", path: [], expected: "an object", actual: null, message: null },
    ],
  },
  {
    // move: Effect 3 `Expected Phase (Encoded side), actual null`.
    name: "a class's encoded struct given null",
    error: refused(Phase, null),
    refusals: [
      { kind: "invalid-type", path: [], expected: "an object", actual: null, message: null },
    ],
  },
  {
    // move: Effect 3 `Expected the verdict, actual "no"`, the description as the label.
    name: "a literal annotated with a description",
    error: refused(Schema.Literal("ok").annotations({ description: "the verdict" }), "no"),
    refusals: [{ kind: "invalid-value", path: [], expected: '"ok"', actual: "no", message: null }],
  },
  {
    // Effect 3: `Expected PhaseId, actual 1`.
    name: "a string with an identifier annotation",
    error: refused(Schema.String.annotations({ identifier: "PhaseId" }), 1),
    refusals: [{ kind: "invalid-type", path: [], expected: "PhaseId", actual: 1, message: null }],
  },
  {
    // Effect 3: `Expected a string matching the pattern ^[a-z]+$, actual "A1"`.
    name: "a pattern filter",
    error: refused(Schema.String.pipe(Schema.pattern(/^[a-z]+$/)), "A1"),
    refusals: [
      {
        kind: "filter",
        path: [],
        expected: "a string matching the pattern ^[a-z]+$",
        actual: "A1",
        message: null,
      },
    ],
  },
  {
    // A minimum of one keeps phax's Effect 3 words, `a non empty string` (operator, 2026-11-09).
    name: "a minLength filter",
    error: refused(Schema.String.pipe(Schema.minLength(1)), ""),
    refusals: [
      { kind: "filter", path: [], expected: "a non empty string", actual: "", message: null },
    ],
  },
  {
    // Effect 3: `Expected a string at least 2 character(s) long, actual "a"`.
    name: "a minLength filter above one",
    error: refused(Schema.String.pipe(Schema.minLength(2)), "a"),
    refusals: [
      {
        kind: "filter",
        path: [],
        expected: "a string at least 2 character(s) long",
        actual: "a",
        message: null,
      },
    ],
  },
  {
    // Effect 3: `a kebab-case slug`, the message alone.
    name: "a filter with a message annotation",
    error: refused(
      Schema.String.pipe(
        Schema.pattern(/^[a-z]+(-[a-z]+)*$/, { message: () => "a kebab-case slug" }),
      ),
      "Not A Slug",
    ),
    refusals: [
      {
        kind: "filter",
        path: [],
        expected: "a string matching the pattern ^[a-z]+(-[a-z]+)*$",
        actual: "Not A Slug",
        message: "a kebab-case slug",
      },
    ],
  },
  {
    // Effect 3: `Expected string, actual 1`.
    name: "a string given a number",
    error: refused(Schema.String, 1),
    refusals: [{ kind: "invalid-type", path: [], expected: "string", actual: 1, message: null }],
  },
  {
    // Effect 3, in this order: `a: is missing`, `b: Expected number, actual "x"`,
    // `c.0: Expected string, actual 1`.
    name: "a struct decoded with every error",
    error: refused(
      Schema.Struct({ a: Schema.String, b: Schema.Number, c: Schema.Array(Schema.String) }),
      { b: "x", c: [1] },
      { errors: "all" },
    ),
    refusals: [
      { kind: "missing", path: ["a"] },
      { kind: "invalid-type", path: ["b"], expected: "number", actual: "x", message: null },
      { kind: "invalid-type", path: ["c", 0], expected: "string", actual: 1, message: null },
    ],
  },
];

describe("refusalsOf", () => {
  it.each(cases)("refuses $name", ({ error, refusals }) => {
    expect(refusalsOf(error)).toEqual(refusals);
  });

  it("lists the refusals of every error at ArrayFormatter's paths, in its order", () => {
    const error = refused(
      Schema.Struct({ a: Schema.String, b: Schema.Number, c: Schema.Array(Schema.String) }),
      { b: "x", c: [1] },
      { errors: "all" },
    );
    expect(refusalsOf(error).map(({ path }) => path)).toEqual(
      ParseResult.ArrayFormatter.formatErrorSync(error).map(({ path }) => path),
    );
  });
});

describe("firstRefusal", () => {
  it.each(cases)("gives the first refusal of $name", ({ error, refusals }) => {
    expect(firstRefusal(error)).toEqual(refusals[0]);
  });
});
