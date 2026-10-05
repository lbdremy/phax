import { describe, expect, it } from "vitest";
import { extractJsonDocumentText } from "../../../src/domain/authoring/jsonText.js";

const DOC = { title: "Plan prune", tags: ["a", "b"], nested: { n: 1 } };
const DOC_TEXT = JSON.stringify(DOC);
const PRETTY = JSON.stringify(DOC, null, 2);

const parsed = (input: string): unknown => JSON.parse(extractJsonDocumentText(input));

describe("extractJsonDocumentText", () => {
  it.each<[string, string, unknown]>([
    ["bare object", DOC_TEXT, DOC],
    ["bare object with surrounding whitespace", `\n  ${PRETTY}\n\n`, DOC],
    ["```json fence", "```json\n" + PRETTY + "\n```", DOC],
    ["bare ``` fence", "```\n" + PRETTY + "\n```", DOC],
    ["leading sentence", "Ground read. Writing the spec document now.\n" + DOC_TEXT, DOC],
    ["trailing sentence", PRETTY + "\n\nLet me know if you'd like changes.", DOC],
    ["leading and trailing prose", "Here it is:\n" + PRETTY + "\nDone — that's the plan.", DOC],
    [
      "fenced object inside prose",
      "Here's the document:\n\n```json\n" + PRETTY + "\n```\n\nI kept it short.",
      DOC,
    ],
    [
      "braces and escaped quotes inside string values",
      'Writing it now.\n{"a":"a } b","b":"say \\"{\\"","c":"back\\\\slash }"}',
      { a: "a } b", b: 'say "{"', c: "back\\slash }" },
    ],
    [
      "a stray unbalanced { in prose before the document",
      "I'll fill the { placeholder later. It's ready:\n" + DOC_TEXT,
      DOC,
    ],
    [
      "a stray quote then { in prose before the document",
      'The "{" glyph opens it. Document:\n' + DOC_TEXT,
      DOC,
    ],
    ["two objects: the last one wins", 'Draft: {"v":1}\nFinal: {"v":2}', { v: 2 }],
    [
      "a document followed by a brace group that does not parse",
      DOC_TEXT + "\nFill in {slug} before approving.",
      DOC,
    ],
    ["a bare top-level array is returned by the first step", "[1,2,3]", [1, 2, 3]],
    ["a fenced top-level array is returned by the first step", "```json\n[1]\n```", [1]],
  ])("%s", (_name, input, expected) => {
    expect(parsed(input)).toEqual(expected);
  });

  it.each<[string, string]>([
    ["prose with no object", "Here is your spec: it is great."],
    ["prose with only an array", "Here they are: [1, 2, 3]"],
    ["prose with a brace group that does not parse", "Use {slug} as the name."],
    ["an object that never closes", 'Here: {"a": 1'],
    ["empty text", ""],
  ])("%s: throws at JSON.parse", (_name, input) => {
    expect(() => parsed(input)).toThrow();
  });

  it("with no usable object, returns the fence-stripped text", () => {
    expect(extractJsonDocumentText("  not json  ")).toBe("not json");
    expect(extractJsonDocumentText("```json\nnot json\n```")).toBe("not json");
  });
});
