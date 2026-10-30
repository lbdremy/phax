import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { answerJson } from "../../../src/domain/session/structuredAnswer.js";

describe("answerJson", () => {
  it("returns a structured value as is and never parses the text beside it", () => {
    const value = { $schema: "https://example.test/x.json", n: 1 };
    const parsed = answerJson({ finalText: "this is { not json", structured: { value } });
    expect(parsed).toEqual(Either.right(value));
    if (Either.isRight(parsed)) expect(parsed.right).toBe(value);
  });

  it("returns a structured value that is itself not an object, for the decoder to refuse", () => {
    expect(answerJson({ finalText: "{}", structured: { value: "text" } })).toEqual(
      Either.right("text"),
    );
    expect(answerJson({ finalText: "{}", structured: { value: null } })).toEqual(
      Either.right(null),
    );
  });

  it("parses the final text when there is no structured value", () => {
    expect(answerJson({ finalText: '{"a":1}', structured: null })).toEqual(Either.right({ a: 1 }));
    expect(answerJson({ finalText: '```json\n{"a":1}\n```', structured: null })).toEqual(
      Either.right({ a: 1 }),
    );
  });

  it.each([
    ["prose", "Looks good!"],
    ["empty", ""],
    ["blank", "  \n"],
  ])("refuses a %s final message as not JSON", (_, finalText) => {
    const parsed = answerJson({ finalText, structured: null });
    expect(Either.isLeft(parsed)).toBe(true);
    if (Either.isLeft(parsed)) {
      expect(parsed.left).toContain("the session's final message is not JSON");
    }
  });
});
