// The corpus's capture and its canonical encoder: capture fills only null
// expectations, never changes a captured one and refuses any effect major but
// 3; the encoder gives one text per value whatever the key order and refuses
// anything that is not plain data.
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  captureFile,
  caseFileText,
  isCaseFile,
  parseCaseFile,
  streamLines,
  type CaseFile,
  type Expected,
  type Replay,
} from "../../effect4Corpus/corpus.js";

const captured: Expected = { ok: false, refusal: "kept: is missing" };

// A replay that answers the input it was given back as the value, and records each call.
function recordingReplay(): { readonly replay: Replay; readonly calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    replay: (subject, input) => {
      calls.push(input);
      return { ok: true, value: { subject, echo: input } };
    },
  };
}

function caseFile(expected: ReadonlyArray<Expected | null>): CaseFile {
  return {
    subject: "config/demo",
    cases: expected.map((e, i) => ({ name: `case ${i}`, input: { n: i }, expected: e })),
  };
}

describe("captureFile", () => {
  const rows: ReadonlyArray<{
    readonly state: string;
    readonly expected: ReadonlyArray<Expected | null>;
    readonly major: number;
    readonly outcome:
      | { readonly kind: "captured"; readonly filled: number; readonly calls: unknown[] }
      | { readonly kind: "refused" };
  }> = [
    {
      state: "all null",
      expected: [null, null],
      major: 3,
      outcome: { kind: "captured", filled: 2, calls: [{ n: 0 }, { n: 1 }] },
    },
    {
      state: "all captured",
      expected: [captured, captured],
      major: 3,
      outcome: { kind: "captured", filled: 0, calls: [] },
    },
    {
      state: "mixed",
      expected: [captured, null],
      major: 3,
      outcome: { kind: "captured", filled: 1, calls: [{ n: 1 }] },
    },
    { state: "all null", expected: [null, null], major: 4, outcome: { kind: "refused" } },
    { state: "all captured", expected: [captured], major: 4, outcome: { kind: "refused" } },
    { state: "mixed", expected: [captured, null], major: 2, outcome: { kind: "refused" } },
  ];

  for (const row of rows) {
    it(`${row.state} on effect ${row.major}: ${row.outcome.kind}`, () => {
      const { replay, calls } = recordingReplay();
      const file = caseFile(row.expected);
      const result = captureFile(file, replay, row.major);
      if (row.outcome.kind === "refused") {
        expect(result).toEqual({
          kind: "refused",
          reason: `the corpus is captured on Effect 3 only; the installed effect major is ${row.major}`,
        });
        expect(calls).toEqual([]);
        return;
      }
      expect(result.kind).toBe("captured");
      if (result.kind !== "captured") return;
      expect(result.filled).toBe(row.outcome.filled);
      expect(calls).toEqual(row.outcome.calls);
      expect(result.file.subject).toBe(file.subject);
      for (const [i, c] of result.file.cases.entries()) {
        const before = file.cases[i];
        expect(c.name).toBe(before?.name);
        expect(c.input).toEqual(before?.input);
        expect(c.expected).toEqual(
          before?.expected ?? { ok: true, value: { echo: { n: i }, subject: "config/demo" } },
        );
      }
    });
  }

  it("leaves a captured expectation's own value as it was, even one the replay would change", () => {
    const file = caseFile([{ ok: true, value: { b: 1, a: 2 } }]);
    const result = captureFile(file, () => ({ ok: false, refusal: "changed" }), 3);
    expect(result).toEqual({ kind: "captured", file, filled: 0 });
  });

  it("stores a filled expectation as plain JSON in canonical key order", () => {
    const result = captureFile(
      caseFile([null]),
      () => ({ ok: true, value: { z: 1, a: [{ y: 2, b: 3 }] } }),
      3,
    );
    if (result.kind !== "captured") throw new Error("refused");
    expect(caseFileText(result.file)).toContain(
      '"expected": {\n        "ok": true,\n        "value": {\n          "a": [\n            {\n              "b": 3,\n              "y": 2',
    );
  });

  it("throws when the replay answers a value that is not plain data", () => {
    expect(() => captureFile(caseFile([null]), () => ({ ok: true, value: new Map() }), 3)).toThrow(
      /a Map instance is not plain data/,
    );
  });

  it("writes a file that reads back as the same case file", () => {
    const result = captureFile(caseFile([null, captured]), recordingReplay().replay, 3);
    if (result.kind !== "captured") throw new Error("refused");
    expect(parseCaseFile(caseFileText(result.file), "demo.json")).toEqual(result.file);
    expect(caseFileText(result.file).endsWith("}\n")).toBe(true);
  });
});

describe("canonicalJson", () => {
  it("gives one text whatever the key order", () => {
    const a = { b: { d: [1, { f: true, e: null }], c: "x" }, a: -0.5 };
    const b = { a: -0.5, b: { c: "x", d: [1, { e: null, f: true }] } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":-0.5,"b":{"c":"x","d":[1,{"e":null,"f":true}]}}');
  });

  it("keeps array order", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it("leaves out a key whose value is undefined, as JSON does", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("accepts an object with no prototype", () => {
    const bare: Record<string, unknown> = Object.create(null);
    bare["k"] = "v";
    expect(canonicalJson(bare)).toBe('{"k":"v"}');
  });

  it.each([
    ["a class instance", { at: new Date(0) }, /\$\.at: a Date instance is not plain data/],
    ["a bigint", [1n], /\$\[0\]: a bigint is not plain data/],
    ["NaN", { n: Number.NaN }, /\$\.n: the number NaN/],
    ["Infinity", Number.POSITIVE_INFINITY, /\$: the number Infinity/],
    ["undefined in an array", [1, undefined], /\$\[1\]: undefined in an array/],
    ["a function", { f: () => 1 }, /\$\.f: a function is not plain data/],
    ["undefined itself", undefined, /\$: undefined is not plain data/],
  ])("refuses %s", (_name, value, message) => {
    expect(() => canonicalJson(value)).toThrow(message);
  });
});

describe("isCaseFile", () => {
  const valid = {
    subject: "answers/demo",
    cases: [
      { name: "a", input: null, expected: null },
      { name: "b", input: [1], expected: { ok: true, value: null } },
      { name: "c", input: {}, expected: { ok: false, refusal: "x" } },
    ],
  };

  it("reads a case file", () => {
    expect(isCaseFile(valid)).toBe(true);
  });

  it.each([
    ["a missing subject", { cases: [] }],
    ["an extra root key", { ...valid, notes: "x" }],
    ["a case without input", { subject: "s", cases: [{ name: "a", expected: null }] }],
    ["a case without expected", { subject: "s", cases: [{ name: "a", input: 1 }] }],
    ["an empty case name", { subject: "s", cases: [{ name: "", input: 1, expected: null }] }],
    ["an extra case key", { subject: "s", cases: [{ name: "a", input: 1, expected: null, x: 1 }] }],
    [
      "ok true without a value",
      { subject: "s", cases: [{ name: "a", input: 1, expected: { ok: true } }] },
    ],
    [
      "ok false with a refusal that is not a string",
      { subject: "s", cases: [{ name: "a", input: 1, expected: { ok: false, refusal: 3 } }] },
    ],
    [
      "an expectation with both value and refusal",
      {
        subject: "s",
        cases: [{ name: "a", input: 1, expected: { ok: false, refusal: "x", value: 1 } }],
      },
    ],
    ["cases that are not an array", { subject: "s", cases: {} }],
  ])("refuses %s", (_name, value) => {
    expect(isCaseFile(value)).toBe(false);
  });

  it("names the source of a file that is not a case file", () => {
    expect(() => parseCaseFile("[]", "cases/x.json")).toThrow(
      "cases/x.json: not a corpus case file",
    );
  });
});

describe("streamLines", () => {
  it("keeps a string line as it is and writes any other entry as its JSON text", () => {
    expect(streamLines(["not json", { type: "x", n: 1 }, 3])).toEqual([
      "not json",
      '{"type":"x","n":1}',
      "3",
    ]);
  });
});
