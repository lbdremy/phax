import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  RETRY_PROMPT_FILENAME,
  RETRY_TRANSCRIPT_FILENAME,
  buildRetryPrompt,
  parseFinalMessageJson,
  refusedTwiceMessage,
  retryWarning,
} from "../../../src/domain/authoring/retry.js";

function refusal(finalText: string): string {
  const parsed = parseFinalMessageJson(finalText);
  if (Either.isRight(parsed)) throw new Error(`expected a refusal for ${finalText}`);
  return parsed.left;
}

// A made-up document with a stray code expression after one of its values.
const STRAY_EXPRESSION = `{"version":1,"kind":"spec","title":"Widget export","context":"Export widgets".replace("a","b"),"problem":"none"}`;
const STRAY_AT = STRAY_EXPRESSION.indexOf(".replace");

describe("parseFinalMessageJson", () => {
  it("parses a document, fenced or amid prose, as extractJsonDocumentText picks it", () => {
    expect(parseFinalMessageJson('{"a":1}')).toEqual(Either.right({ a: 1 }));
    expect(parseFinalMessageJson('```json\n{"a":1}\n```')).toEqual(Either.right({ a: 1 }));
    expect(parseFinalMessageJson('Writing it now.\n{"a":1}')).toEqual(Either.right({ a: 1 }));
  });

  it("names the parser error and the position of a stray .replace(...) expression", () => {
    const reason = refusal(STRAY_EXPRESSION);
    expect(reason).toMatch(/^the session's final message is not JSON \(.+ at position \d+\): /);
    expect(reason).toContain(`at position ${STRAY_AT})`);
    expect(reason).toContain("after property value");
    expect(reason.endsWith(`: ${STRAY_EXPRESSION.slice(0, 200)}`)).toBe(true);
  });

  it("finds the position itself when the engine's message names none", () => {
    // V8 reports these without a position.
    expect(refusal('{"a":tru}')).toMatch(/\(Unexpected token '}' at position 8\): /);
    expect(refusal('{"a":')).toMatch(/\(Unexpected end of JSON input at position 5\): /);
    expect(refusal("")).toMatch(/\(Unexpected end of JSON input at position 0\): $/);
  });

  it("reports the position against the text that was parsed, with one line of error", () => {
    expect(refusal('{"a":[1,2,]}')).toMatch(/ at position 10\): /);
    expect(refusal("[1,2],")).toMatch(/ at position 5\): /);
    // A fence is stripped before parsing: the position counts from inside it.
    expect(refusal('```json\n{"a":tru}\n```')).toMatch(/ at position 8\): /);
    expect(refusal("{'a':1}")).toMatch(/ at position 1\): /);
    for (const text of ['{"a":tru}', STRAY_EXPRESSION, `{"a":"x${"y".repeat(400)}"]`]) {
      expect(refusal(text)).not.toContain("\n");
      expect(refusal(text)).not.toContain("is not valid JSON");
    }
  });

  it("quotes only the first 200 characters of the final message", () => {
    const text = `{"a":"${"x".repeat(400)}" oops}`;
    expect(refusal(text).endsWith(`: ${text.slice(0, 200)}`)).toBe(true);
  });
});

describe("the retry's texts", () => {
  it("the prompt names the refusal, says nothing was written, and asks for the whole document", () => {
    const prompt = buildRetryPrompt("spec", "acceptanceCriteria[0].refs: is missing");
    expect(prompt).toBe(
      [
        "Your final message was refused, and phax wrote nothing.",
        "",
        "Refusal: spec document rejected — acceptanceCriteria[0].refs: is missing",
        "",
        "Return the whole spec document again as your final message: one JSON object valid against the schema you were given, with no code fence and no commentary. This is your only retry.",
        "",
      ].join("\n"),
    );
  });

  it("the prompt repeats neither the schema nor the brief", () => {
    const prompt = buildRetryPrompt("plan", "phases[0].id: is missing");
    expect(prompt).not.toContain("JSON Schema");
    expect(prompt).not.toContain('"type"');
    expect(prompt).not.toContain("## Brief");
    expect(prompt).toContain("the whole plan document");
  });

  it("the warning names the refusal and the one resume", () => {
    expect(retryWarning("spec", "acceptanceCriteria[0].refs: is missing")).toBe(
      "spec document refused — acceptanceCriteria[0].refs: is missing\n  resuming the session once to ask for the whole document again",
    );
  });

  it("the twice-refused error names both refusals", () => {
    expect(refusedTwiceMessage("plan", "first reason", "second reason")).toBe(
      "plan document rejected twice — first answer: first reason; retry: second reason",
    );
  });

  it("the retry's files sit beside output.jsonl under their own names", () => {
    expect(RETRY_PROMPT_FILENAME).toBe("retry-prompt.md");
    expect(RETRY_TRANSCRIPT_FILENAME).toBe("retry-output.jsonl");
  });
});
