import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  formatFirstViolation,
  formatParseError,
  issueMessage,
} from "../../../src/schemas/formatError.js";

// A value that should have been an object or an array reads in phax's words,
// not as Effect's full type description; every other message is Effect's.

const Config = Schema.Struct({
  name: Schema.NonEmptyString,
  steps: Schema.Array(Schema.Struct({ command: Schema.String })),
});

function refusal(input: unknown, render: (e: never) => string): string {
  const decoded = Schema.decodeUnknownEither(Config, { errors: "all" })(input);
  if (Either.isRight(decoded)) throw new Error("expected a refusal");
  return render(decoded.left as never);
}

describe("issueMessage", () => {
  it("names a whole struct or array by its kind and keeps the actual value", () => {
    expect(
      issueMessage("Expected { readonly a: { readonly b: string }; readonly c: 1 }, actual null"),
    ).toBe("Expected an object, actual null");
    expect(
      issueMessage('Expected ReadonlyArray<{ readonly m: ReadonlyArray<string> }>, actual "none"'),
    ).toBe('Expected an array, actual "none"');
  });

  it("leaves every other message as Effect wrote it", () => {
    for (const message of [
      "Expected string, actual 3",
      'Expected "spec", actual "plan"',
      "is missing",
      'is unexpected, expected: "a" | "b"',
      "Expected { readonly a: string }",
      'Expected { ReadonlyArray<string> | filter }, actual ["x"]',
      'Expected { { readonly a: number; readonly b: number } | filter }, actual {"a":2,"b":1}',
    ]) {
      expect(issueMessage(message)).toBe(message);
    }
  });

  it("is what the formatters print for a value of the wrong shape", () => {
    expect(refusal(null, formatParseError)).toBe("  (root): Expected an object, actual null");
    expect(refusal({ name: "x", steps: "none" }, formatFirstViolation)).toBe(
      'steps: Expected an array, actual "none"',
    );
    expect(refusal({ name: "", steps: [] }, formatParseError)).toBe(
      '  name: Expected a non empty string, actual ""',
    );
  });
});
