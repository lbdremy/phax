// A union of objects told apart by a key: the refusal reads the member the input chose. A
// member refused on one of its own keys (a literal the value misses, a key it does not
// declare) gives way to a member whose type there accepts the value; when no member accepts
// it, every member's refusal stays.
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { refusalsOf } from "../../../../src/schemas/refusal/adapter.js";
import { refusalMessage, refusalPath } from "../../../../src/schemas/refusal/render.js";

const Failed = Schema.Struct({
  outcome: Schema.Literal("failed"),
  commit: Schema.Null,
  failure: Schema.Literals(["refused", "timeout"]),
});
const Committed = Schema.Struct({
  outcome: Schema.Literal("committed"),
  commit: Schema.NonEmptyString,
  arbitrated: Schema.Array(Schema.String),
});
// The failed member first, so Effect 3's order would print its line.
const Record = Schema.Union([Failed, Committed]);

function lines(input: unknown): ReadonlyArray<string> {
  const decoded = Schema.decodeUnknownResult(Record, {
    onExcessProperty: "error",
    reportInput: true,
  })(input);
  if (Result.isSuccess(decoded)) throw new Error(`expected a refusal of ${JSON.stringify(input)}`);
  return refusalsOf(decoded.failure).map(
    (r) => `${refusalPath(r.path, "dotted")}: ${refusalMessage(r)}`,
  );
}

describe("a union of objects told apart by a key", () => {
  it("reads the chosen member's refusal, not the other member's tag", () => {
    expect(lines({ outcome: "committed", commit: "abc" })).toEqual(["arbitrated: is missing"]);
  });

  it("reads the chosen member's refusal when the other member stops at a non-tag key", () => {
    expect(lines({ outcome: "committed", commit: "abc", arbitrated: [1] })).toEqual([
      "arbitrated.0: Expected string, actual 1",
    ]);
  });

  it("gives way on a key the refused member does not declare", () => {
    expect(lines({ outcome: "failed", commit: null, failure: "timeout", arbitrated: [] })).toEqual([
      'arbitrated: is unexpected, expected: "outcome" | "commit" | "failure"',
    ]);
  });

  it("names every member's tag when no member accepts the tag's value", () => {
    expect(lines({ outcome: "bogus", commit: null, failure: "timeout" })).toEqual([
      'outcome: Expected "failed" | "committed", actual "bogus"',
    ]);
  });
});
