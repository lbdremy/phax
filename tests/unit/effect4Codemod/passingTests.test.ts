// The test ratchet's verdict table, the hand-written guard on its record, the record's
// serialization, and the reading of vitest's JSON report.
import { describe, expect, it } from "vitest";
import {
  judgeTests,
  parseVitestJson,
  serializeTestRecord,
  toTestRecord,
  type TestOutcome,
  type TestStatus,
} from "../../../scripts/effect4-codemod/passingTests.js";

const FILE = "tests/unit/a.test.ts";
const id = { file: FILE, name: "a > b" };

const outcome = (status: TestStatus, name = id.name, file = FILE): TestOutcome => ({
  file,
  name,
  status,
});

describe("judgeTests", () => {
  it("records the measured passing set when there is no base", () => {
    expect(
      judgeTests(null, [
        outcome("passed", "z"),
        outcome("failed", "y"),
        outcome("skipped", "x"),
        outcome("passed", "m", "tests/unit/b.test.ts"),
        outcome("passed", "a"),
      ]),
    ).toEqual({
      verdict: { kind: "record" },
      next: { [FILE]: ["a", "z"], "tests/unit/b.test.ts": ["m"] },
    });
  });

  it("records nothing from a run with no passing test", () => {
    expect(judgeTests(null, [])).toEqual({ verdict: { kind: "record" }, next: {} });
  });

  // Every (recorded status, measured status) pair for one test, `a > b`.
  const nothing = { failed: [], skipped: [], missing: [] };
  const table: ReadonlyArray<readonly [string, boolean, TestStatus | null, unknown]> = [
    ["recorded, passed", true, "passed", { kind: "pass", added: [] }],
    ["recorded, failed", true, "failed", { kind: "fail", ...nothing, failed: [id] }],
    ["recorded, skipped", true, "skipped", { kind: "fail", ...nothing, skipped: [id] }],
    ["recorded, absent", true, null, { kind: "fail", ...nothing, missing: [id] }],
    ["not recorded, passed", false, "passed", { kind: "pass", added: [id] }],
    ["not recorded, failed", false, "failed", { kind: "pass", added: [] }],
    ["not recorded, skipped", false, "skipped", { kind: "pass", added: [] }],
    ["not recorded, absent", false, null, { kind: "pass", added: [] }],
  ];
  it.each(table)("%s", (_name, recorded, measured, verdict) => {
    const base = { [FILE]: recorded ? [id.name, "other"] : ["other"] };
    const others = [outcome("passed", "other")];
    const run = measured === null ? others : [...others, outcome(measured)];
    const judgement = judgeTests(base, run);
    expect(judgement.verdict).toEqual(verdict);
    expect(judgement.next).toEqual({
      [FILE]: measured === "passed" ? ["a > b", "other"] : ["other"],
    });
  });

  it.each<[string, ReadonlyArray<TestStatus>, unknown]>([
    ["passed twice", ["passed", "passed"], { kind: "pass", added: [] }],
    ["passed, then failed", ["passed", "failed"], { kind: "fail", ...nothing, failed: [id] }],
    ["failed, then passed", ["failed", "passed"], { kind: "fail", ...nothing, failed: [id] }],
    ["passed, then skipped", ["passed", "skipped"], { kind: "fail", ...nothing, skipped: [id] }],
    ["skipped, then failed", ["skipped", "failed"], { kind: "fail", ...nothing, failed: [id] }],
  ])("a recorded name occurring twice: %s", (_name, statuses, verdict) => {
    const judgement = judgeTests(
      { [FILE]: [id.name] },
      statuses.map((status) => outcome(status)),
    );
    expect(judgement.verdict).toEqual(verdict);
    expect(judgement.next).toEqual(
      statuses.every((s) => s === "passed") ? { [FILE]: [id.name] } : {},
    );
  });

  it("does not add a new name unless every occurrence passed", () => {
    const judgement = judgeTests({}, [outcome("passed"), outcome("failed")]);
    expect(judgement).toEqual({ verdict: { kind: "pass", added: [] }, next: {} });
  });

  it("tells the same name in two files apart", () => {
    const judgement = judgeTests({ [FILE]: ["t"], "tests/unit/b.test.ts": ["t"] }, [
      outcome("passed", "t"),
    ]);
    expect(judgement.verdict).toEqual({
      kind: "fail",
      ...nothing,
      missing: [{ file: "tests/unit/b.test.ts", name: "t" }],
    });
  });

  it("lists the failed, skipped and missing tests sorted by file, then name", () => {
    const base = { "tests/b.test.ts": ["y", "x"], "tests/a.test.ts": ["w", "v", "u"] };
    const judgement = judgeTests(base, [
      outcome("failed", "y", "tests/b.test.ts"),
      outcome("failed", "x", "tests/b.test.ts"),
      outcome("skipped", "w", "tests/a.test.ts"),
      outcome("failed", "u", "tests/a.test.ts"),
    ]);
    expect(judgement.verdict).toEqual({
      kind: "fail",
      failed: [
        { file: "tests/a.test.ts", name: "u" },
        { file: "tests/b.test.ts", name: "x" },
        { file: "tests/b.test.ts", name: "y" },
      ],
      skipped: [{ file: "tests/a.test.ts", name: "w" }],
      missing: [{ file: "tests/a.test.ts", name: "v" }],
    });
  });

  it("holds an empty base to nothing and adds every passing test", () => {
    expect(judgeTests({}, [outcome("passed")]).verdict).toEqual({ kind: "pass", added: [id] });
  });
});

describe("toTestRecord", () => {
  it("accepts an object from file to distinct names, sorting the names", () => {
    expect(toTestRecord({ [FILE]: ["b", "a"], "tests/unit/c.test.ts": [] })).toEqual({
      [FILE]: ["a", "b"],
      "tests/unit/c.test.ts": [],
    });
    expect(toTestRecord({})).toEqual({});
  });

  it.each([
    ["null", null],
    ["a string", "tests"],
    ["an array", [FILE]],
    ["a file holding a string", { [FILE]: "a" }],
    ["a file holding a number", { [FILE]: [1] }],
    ["a file holding null", { [FILE]: null }],
    ["a duplicate name", { [FILE]: ["a", "a"] }],
    ["an empty file key", { "": ["a"] }],
  ])("refuses %s", (_name, value) => {
    expect(toTestRecord(value)).toBeNull();
  });
});

describe("serializeTestRecord", () => {
  it("sorts the keys and names and writes two-space JSON with a final newline", () => {
    expect(serializeTestRecord({ "tests/b.test.ts": ["z", "a"], "tests/a.test.ts": ["m"] })).toBe(
      '{\n  "tests/a.test.ts": [\n    "m"\n  ],\n  "tests/b.test.ts": [\n    "a",\n    "z"\n  ]\n}\n',
    );
  });

  it("writes an empty record as an empty object", () => {
    expect(serializeTestRecord({})).toBe("{}\n");
  });

  it("reads back what it wrote", () => {
    const record = { [FILE]: ["a > b", "c"] };
    expect(toTestRecord(JSON.parse(serializeTestRecord(record)))).toEqual(record);
  });
});

/** A JSON reporter report holding `testResults`. */
function report(testResults: ReadonlyArray<unknown>): string {
  return JSON.stringify({ numTotalTests: 0, success: false, testResults });
}

/** One entry of a file's `assertionResults`. */
function assertion(ancestorTitles: ReadonlyArray<string>, title: string, status: string) {
  return {
    ancestorTitles,
    fullName: [...ancestorTitles, title].join(" "),
    status,
    title,
    failureMessages: [],
  };
}

describe("parseVitestJson", () => {
  const root = "/repo";

  it("names a test by its file relative to the root and its ancestors and title", () => {
    const text = report([
      {
        name: "/repo/tests/unit/a.test.ts",
        status: "failed",
        message: "",
        assertionResults: [
          assertion([], "top", "passed"),
          assertion(["outer", "inner"], "deep", "failed"),
        ],
      },
    ]);
    expect(parseVitestJson(text, root)).toEqual([
      { file: "tests/unit/a.test.ts", name: "top", status: "passed" },
      { file: "tests/unit/a.test.ts", name: "outer > inner > deep", status: "failed" },
    ]);
  });

  it.each(["skipped", "pending", "todo", "disabled"])("counts %s as skipped", (status) => {
    const text = report([
      { name: "/repo/tests/a.test.ts", assertionResults: [assertion([], "t", status)] },
    ]);
    expect(parseVitestJson(text, root)).toEqual([
      { file: "tests/a.test.ts", name: "t", status: "skipped" },
    ]);
  });

  it("takes no test from a file that failed to load", () => {
    const text = report([
      {
        name: "/repo/tests/broken.test.ts",
        status: "failed",
        message: "Failed to load url ./missing.js",
        assertionResults: [],
      },
      { name: "/repo/tests/a.test.ts", assertionResults: [assertion([], "t", "passed")] },
    ]);
    expect(parseVitestJson(text, root)).toEqual([
      { file: "tests/a.test.ts", name: "t", status: "passed" },
    ]);
  });

  it("reads a report with no test file as no tests", () => {
    expect(parseVitestJson(report([]), root)).toEqual([]);
  });

  it.each([
    ["text that is not JSON", "Error: vitest crashed"],
    ["an empty text", ""],
    ["a JSON array", "[]"],
    ["an object without testResults", '{ "success": true }'],
    ["a relative file name", report([{ name: "tests/a.test.ts", assertionResults: [] }])],
    ["a file outside the root", report([{ name: "/elsewhere/a.test.ts", assertionResults: [] }])],
    ["a file without assertionResults", report([{ name: "/repo/tests/a.test.ts" }])],
    [
      "an assertion without a title",
      report([
        {
          name: "/repo/tests/a.test.ts",
          assertionResults: [{ ancestorTitles: [], status: "passed" }],
        },
      ]),
    ],
    [
      "an unknown status",
      report([{ name: "/repo/tests/a.test.ts", assertionResults: [assertion([], "t", "lost")] }]),
    ],
  ])("throws on %s", (_name, text) => {
    expect(() => parseVitestJson(text, root)).toThrow(/vitest report/);
  });
});
