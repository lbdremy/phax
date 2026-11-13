// The corpus's capture and its canonical encoder: capture fills only null
// expectations, never changes a captured one and refuses any effect major but
// 3; the encoder gives one text per value whatever the key order and refuses
// anything that is not plain data. A captured expectation reads the same on
// both sides of a release cut and of the next opening.
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  captureCorpusFile,
  captureFile,
  caseFileText,
  expectedAt,
  isCaseFile,
  parseCaseFile,
  parseCorpusFile,
  parseReleaseLedger,
  streamLines,
  type CaseFile,
  type Expected,
  type FormatCaseFile,
  type Replay,
} from "../../behaviourCorpus/corpus.js";

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

// A format case file: current cases through the parse function, one list per frozen shape.
function formatFile(): FormatCaseFile {
  return {
    format: "demo",
    current: [{ name: "reads one", input: { n: 1 }, expected: null }],
    shapes: {
      "pre-schema": [{ name: "reads old", input: { n: 2 }, expected: null }],
      "0.17.0": [{ name: "refuses old", input: { n: 3 }, expected: captured }],
    },
  };
}

describe("format case files", () => {
  it("fills the current cases through format:<id> and each shape through frozen:<id>/<shape>", () => {
    const { replay, calls } = recordingReplay();
    const seen: string[] = [];
    const result = captureCorpusFile(
      formatFile(),
      (subject, input) => {
        seen.push(subject);
        return replay(subject, input);
      },
      3,
    );
    if (result.kind !== "captured") throw new Error("refused");
    expect(result.filled).toBe(2);
    expect(seen).toEqual(["format:demo", "frozen:demo/pre-schema"]);
    expect(calls).toEqual([{ n: 1 }, { n: 2 }]);
    expect(parseCorpusFile(caseFileText(result.file), "demo.json")).toEqual(result.file);
  });

  it("is refused on any effect major but 3", () => {
    expect(captureCorpusFile(formatFile(), recordingReplay().replay, 4).kind).toBe("refused");
  });

  it("reads as a subject case file whose inputs name their target", () => {
    const flat = parseCaseFile(JSON.stringify(formatFile()), "formats/demo.json");
    expect(flat.subject).toBe("formats/demo");
    expect(flat.cases.map((c) => [c.name, c.input])).toEqual([
      ["current reads one", { target: "format:demo", document: { n: 1 } }],
      ["pre-schema reads old", { target: "frozen:demo/pre-schema", document: { n: 2 } }],
      ["0.17.0 refuses old", { target: "frozen:demo/0.17.0", document: { n: 3 } }],
    ]);
    expect(flat.cases.map((c) => c.expected)).toEqual([null, null, captured]);
  });

  it("holds a shape on an accepted expectation and no other key", () => {
    const ok = { ok: true, shape: "0.17.0", value: { a: 1 } };
    const file = JSON.stringify({
      format: "demo",
      current: [{ name: "n", input: 1, expected: ok }],
      shapes: {},
    });
    expect(parseCorpusFile(file, "demo.json")).toEqual(JSON.parse(file));
    const bad = JSON.stringify({
      format: "demo",
      current: [{ name: "n", input: 1, expected: { ...ok, extra: 1 } }],
      shapes: {},
    });
    expect(() => parseCorpusFile(bad, "demo.json")).toThrow(/not a corpus case file/);
  });
});

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

describe("expectedAt", () => {
  const stamped = (release: string): unknown => ({
    $schema: `https://docs.phax.run/schemas/demo/${release}.json`,
    n: 1,
  });
  const next: Expected = { ok: true, shape: "next", value: { n: 1 } };
  // The tree a release cycle runs: opened 0.38.0, its cut, the 0.39.0 opening, and a
  // later cycle that changes the format again.
  const opened = { packageVersion: "0.38.0", releases: ["0.36.0", "0.37.0"] };
  const cut = { packageVersion: "0.38.0", releases: ["0.36.0", "0.37.0", "0.38.0"] };
  const reopened = { packageVersion: "0.39.0", releases: cut.releases };
  const later = { packageVersion: "0.41.0", releases: [...cut.releases, "0.39.0", "0.40.0"] };

  it("expects next while the release the document names is not cut", () => {
    expect(expectedAt(next, opened, stamped("0.38.0"))).toEqual(next);
  });

  it.each([
    ["the cut", cut],
    ["the next opening", reopened],
    ["a later cycle", later],
  ])("expects the release the document names on %s", (_tree, tree) => {
    expect(expectedAt(next, tree, stamped("0.38.0"))).toEqual({ ...next, shape: "0.38.0" });
  });

  it("expects next for a document the later cycle's opened release stamps", () => {
    expect(expectedAt(next, later, stamped("0.41.0"))).toEqual(next);
  });

  it("keeps next for a document that names no release", () => {
    expect(expectedAt(next, cut, { n: 1 })).toEqual(next);
    expect(expectedAt(next, cut, { $schema: 3 })).toEqual(next);
  });

  it("keeps a released shape and an expectation without one as they are", () => {
    const released: Expected = { ok: true, shape: "0.37.0", value: { n: 1 } };
    const plain: Expected = { ok: true, value: { n: 1 } };
    expect(expectedAt(released, later, stamped("0.37.0"))).toBe(released);
    expect(expectedAt(plain, later, stamped("0.38.0"))).toBe(plain);
  });

  it("names the tree's package version in a refusal", () => {
    const refused: Expected = {
      ok: false,
      refusal: "$schema: 0.99.0 is newer than @lbdremy/phax-schemas {package-version}",
    };
    expect(expectedAt(refused, reopened, stamped("0.99.0"))).toEqual({
      ok: false,
      refusal: "$schema: 0.99.0 is newer than @lbdremy/phax-schemas 0.39.0",
    });
  });
});

describe("parseReleaseLedger", () => {
  it("reads the releases a ledger lists", () => {
    expect(parseReleaseLedger('{ "releases": ["0.17.0", "0.38.0"] }', "releases.json")).toEqual([
      "0.17.0",
      "0.38.0",
    ]);
  });

  it.each([["[]"], ['{ "releases": "0.38.0" }'], ['{ "releases": ["next"] }']])(
    "names the source of %s",
    (text) => {
      expect(() => parseReleaseLedger(text, "releases.json")).toThrow(
        "releases.json: not a release ledger",
      );
    },
  );
});
