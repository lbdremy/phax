import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { answerJson } from "../../../src/domain/session/structuredAnswer.js";

describe("answerJson", () => {
  it("returns a structured value as is and never parses the text beside it", () => {
    const value = { $schema: "https://example.test/x.json", n: 1 };
    const parsed = answerJson({ finalText: "this is { not json", structured: { value } });
    expect(parsed).toEqual(Result.succeed(value));
    if (Result.isSuccess(parsed)) expect(parsed.right).toBe(value);
  });

  it("returns a structured value that is itself not an object, for the decoder to refuse", () => {
    expect(answerJson({ finalText: "{}", structured: { value: "text" } })).toEqual(
      Result.succeed("text"),
    );
    expect(answerJson({ finalText: "{}", structured: { value: null } })).toEqual(
      Result.succeed(null),
    );
  });

  it("parses the final text when there is no structured value", () => {
    expect(answerJson({ finalText: '{"a":1}', structured: null })).toEqual(
      Result.succeed({ a: 1 }),
    );
    expect(answerJson({ finalText: '```json\n{"a":1}\n```', structured: null })).toEqual(
      Result.succeed({ a: 1 }),
    );
  });

  it.each([
    ["prose", "Looks good!"],
    ["empty", ""],
    ["blank", "  \n"],
  ])("refuses a %s final message as not JSON", (_, finalText) => {
    const parsed = answerJson({ finalText, structured: null });
    expect(Result.isFailure(parsed)).toBe(true);
    if (Result.isFailure(parsed)) {
      expect(parsed.left).toContain("the session's final message is not JSON");
    }
  });
});
