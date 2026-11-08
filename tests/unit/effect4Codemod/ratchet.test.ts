// The ratchet's verdict table, and the hand-written guard on the counts file.
import { describe, expect, it } from "vitest";
import { judge, serializeCounts, toCounts } from "../../../scripts/effect4-codemod/ratchet.js";

describe("judge", () => {
  it("records the first counts when there is no base", () => {
    expect(judge(null, { src: 0, tests: 0 })).toEqual({ kind: "record" });
    expect(judge(null, { src: 400, tests: 90 })).toEqual({ kind: "record" });
  });

  const base = { src: 10, tests: 20 };
  const table: ReadonlyArray<readonly [string, { src: number; tests: number }, unknown]> = [
    ["equal", { src: 10, tests: 20 }, { kind: "pass" }],
    ["both lower", { src: 3, tests: 0 }, { kind: "pass" }],
    ["src lower, tests equal", { src: 9, tests: 20 }, { kind: "pass" }],
    ["src higher", { src: 11, tests: 20 }, { kind: "fail", exceeded: ["src"] }],
    ["tests higher", { src: 10, tests: 21 }, { kind: "fail", exceeded: ["tests"] }],
    ["both higher", { src: 11, tests: 21 }, { kind: "fail", exceeded: ["src", "tests"] }],
    ["src higher, tests lower", { src: 12, tests: 1 }, { kind: "fail", exceeded: ["src"] }],
    ["src lower, tests higher", { src: 1, tests: 25 }, { kind: "fail", exceeded: ["tests"] }],
  ];
  it.each(table)("against a base of 10 and 20: %s", (_name, measured, expected) => {
    expect(judge(base, measured)).toEqual(expected);
  });

  it("holds a base of zero to zero", () => {
    expect(judge({ src: 0, tests: 0 }, { src: 0, tests: 0 })).toEqual({ kind: "pass" });
    expect(judge({ src: 0, tests: 0 }, { src: 1, tests: 0 })).toEqual({
      kind: "fail",
      exceeded: ["src"],
    });
  });
});

describe("toCounts", () => {
  it("accepts exactly src and tests as counts", () => {
    expect(toCounts({ src: 1, tests: 2 })).toEqual({ src: 1, tests: 2 });
  });

  it.each([
    ["null", null],
    ["an array", [1, 2]],
    ["a missing key", { src: 1 }],
    ["an extra key", { src: 1, tests: 2, other: 3 }],
    ["a string count", { src: "1", tests: 2 }],
    ["a negative count", { src: -1, tests: 2 }],
    ["a fractional count", { src: 1.5, tests: 2 }],
  ])("refuses %s", (_name, value) => {
    expect(toCounts(value)).toBeNull();
  });
});

describe("serializeCounts", () => {
  it("writes two-space JSON with a final newline", () => {
    expect(serializeCounts({ src: 4, tests: 7 })).toBe('{\n  "src": 4,\n  "tests": 7\n}\n');
  });
});
