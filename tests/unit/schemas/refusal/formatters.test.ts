import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  formatAnswerViolations,
  formatConfigParseError,
  formatFirstViolation,
  formatParseError,
  formatPlanDocumentViolation,
} from "../../../../src/schemas/formatError.js";

// phax's formatters print every refusal line from its refusal model. These are
// the cases of the former issueMessage tests, through the public formatters,
// plus the shapes the label rules name: a tuple, a union of shapes, a struct
// behind a transformation and a literal with a description.

const Config = Schema.Struct({
  name: Schema.NonEmptyString,
  steps: Schema.Array(Schema.Struct({ command: Schema.String })),
});

function refused<A, I>(schema: Schema.Schema<A, I>, input: unknown): never {
  const decoded = Schema.decodeUnknownEither(schema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
  if (Either.isRight(decoded)) throw new Error("expected a refusal");
  return decoded.left as never;
}

describe("a value of the wrong shape", () => {
  it("names a whole struct or array by its kind and keeps the actual value", () => {
    expect(formatParseError(refused(Config, null))).toBe(
      "  (root): Expected an object, actual null",
    );
    expect(formatFirstViolation(refused(Config, { name: "x", steps: "none" }))).toBe(
      'steps: Expected an array, actual "none"',
    );
  });

  it("names an empty string's refusal in phax's words", () => {
    expect(formatParseError(refused(Config, { name: "", steps: [] }))).toBe(
      '  name: Expected a non empty string, actual ""',
    );
  });

  it("names a tuple by its kind", () => {
    const Pair = Schema.Tuple(Schema.String, Schema.Number);
    expect(formatParseError(refused(Pair, "x"))).toBe('  (root): Expected a tuple, actual "x"');
    expect(formatFirstViolation(refused(Pair, ["a", "b"]))).toBe(
      '[1]: Expected number, actual "b"',
    );
  });

  it("names a struct behind a transformation by its kind", () => {
    const Renamed = Schema.transform(
      Schema.Struct({ a: Schema.String }),
      Schema.Struct({ b: Schema.String }),
      { decode: (x) => ({ b: x.a }), encode: (x) => ({ a: x.b }) },
    );
    expect(formatParseError(refused(Renamed, "q"))).toBe(
      '  (root): Expected an object, actual "q"',
    );
  });
});

describe("a union", () => {
  const Shapes = Schema.Union(
    Schema.Struct({ kind: Schema.Literal("a"), x: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("b"), y: Schema.String }),
  );

  it("of object shapes reads as the object it is not", () => {
    expect(formatParseError(refused(Shapes, 3))).toBe("  (root): Expected an object, actual 3");
  });

  it("of object shapes reports the discriminator's own refusal", () => {
    expect(formatParseError(refused(Shapes, { kind: "c" }))).toBe(
      '  kind: Expected "a" | "b", actual "c"',
    );
  });

  it("where one member got deeper reports only that member", () => {
    const Maybe = Schema.NullOr(Schema.Struct({ a: Schema.Number }));
    expect(formatParseError(refused(Maybe, { a: "x" }))).toBe('  a: Expected number, actual "x"');
    expect(formatParseError(refused(Maybe, 1))).toBe(
      "  (root): Expected one of an object | null, actual 1",
    );
  });
});

describe("a literal", () => {
  it("is labelled by its text, whatever its description says", () => {
    const Kind = Schema.Literal("spec").annotations({ description: "The kind of document" });
    expect(formatParseError(refused(Kind, "plan"))).toBe(
      '  (root): Expected "spec", actual "plan"',
    );
    expect(formatFirstViolation(refused(Schema.Struct({ kind: Kind }), { kind: "plan" }))).toBe(
      'kind: Expected "spec", actual "plan"',
    );
  });
});

describe("formatAnswerViolations", () => {
  const Answer = Schema.Struct({ $schema: Schema.String, verdicts: Schema.Array(Schema.String) });

  it("joins the answer's own key refusals, $schema first", () => {
    expect(formatAnswerViolations(refused(Answer, { version: 1 }))).toBe(
      '$schema: is missing; version: is unexpected, expected: "$schema" | "verdicts"; verdicts: is missing',
    );
  });

  it("reads the first violation at its full path when no own key is refused", () => {
    expect(formatAnswerViolations(refused(Answer, { $schema: "s", verdicts: [1] }))).toBe(
      "verdicts[0]: Expected string, actual 1",
    );
  });
});

describe("formatConfigParseError", () => {
  const Push = Schema.Struct({
    brief: Schema.optional(
      Schema.Struct({ push: Schema.Literal("findings", "findings-and-rules") }),
    ),
    assignments: Schema.optional(Schema.Array(Schema.Struct({ kind: Schema.String }))),
  });

  it("names an invalid brief.push once, in its own words", () => {
    const raw = { brief: { push: "nope" } };
    expect(formatConfigParseError(raw, refused(Push, raw))).toBe(
      '  brief.push must be "findings" or "findings-and-rules"',
    );
  });

  it("names a bound as assignments[N] and an empty list as such", () => {
    const raw = { assignments: [{ kind: "ok" }, { kind: 1 }] };
    expect(formatConfigParseError(raw, refused(Push, raw))).toBe(
      "  assignments[1].kind: Expected string, actual 1",
    );
  });
});

describe("formatPlanDocumentViolation", () => {
  const Plan = Schema.Struct({
    phases: Schema.Array(
      Schema.Struct({ id: Schema.String, testStrategy: Schema.Array(Schema.String) }),
    ),
  });

  it("names the phase and the test line", () => {
    const input = { phases: [{ id: "phase-02", testStrategy: ["a", 2] }] };
    expect(formatPlanDocumentViolation(input, refused(Plan, input))).toBe(
      "phase-02 test line 2: Expected string, actual 2",
    );
  });
});

describe("the source", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
    });
  }

  it("calls no ArrayFormatter and reads no Effect issue message outside the adapter", () => {
    const root = join(import.meta.dirname, "../../../../src");
    const offenders = ["schemas", "domain", "app"]
      .flatMap((layer) => sources(join(root, layer)))
      .filter((path) => !path.endsWith(join("schemas", "refusal", "adapter.ts")))
      .filter((path) =>
        /ArrayFormatter|issueMessage|LITERAL_MISMATCH_RE/.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
