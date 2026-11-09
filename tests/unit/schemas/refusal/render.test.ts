import { describe, expect, it } from "vitest";
import type { Refusal, RefusalPath } from "../../../../src/schemas/refusal/model.js";
import {
  formatActual,
  refusalMessage,
  refusalPath,
} from "../../../../src/schemas/refusal/render.js";

// Acceptance tests for phax's refusal renderer: every kind renders today's
// words, and every actual value prints as Effect 3's ArrayFormatter printed it
// for the same JSON data (read on effect 3.21.2).

const messages: ReadonlyArray<readonly [string, Refusal, string]> = [
  ["missing", { kind: "missing", path: ["a"] }, "is missing"],
  [
    "unexpected",
    { kind: "unexpected", path: ["c"], expected: '"a" | "b"' },
    'is unexpected, expected: "a" | "b"',
  ],
  [
    "invalid-type without a message",
    { kind: "invalid-type", path: [], expected: "an object", actual: null, message: null },
    "Expected an object, actual null",
  ],
  [
    "invalid-type with a message",
    {
      kind: "invalid-type",
      path: ["phase"],
      expected: "an object",
      actual: 1,
      message: "a phase must be an object",
    },
    "a phase must be an object",
  ],
  [
    "invalid-value without a message",
    { kind: "invalid-value", path: [], expected: '"a" | "b"', actual: "c", message: null },
    'Expected "a" | "b", actual "c"',
  ],
  [
    "invalid-value with a message",
    {
      kind: "invalid-value",
      path: ["severity"],
      expected: '"high" | "low"',
      actual: "mid",
      message: '"mid" is not a severity (expected one of high, low)',
    },
    '"mid" is not a severity (expected one of high, low)',
  ],
  [
    "filter without a message",
    {
      kind: "filter",
      path: ["name"],
      expected: "a string at least 1 character(s) long",
      actual: "",
      message: null,
    },
    'Expected a string at least 1 character(s) long, actual ""',
  ],
  [
    "filter with a message",
    {
      kind: "filter",
      path: ["id"],
      expected: "a string matching the pattern ^[a-z0-9]+(-[a-z0-9]+)*$",
      actual: "Not A Slug",
      message: "a kebab-case slug: lowercase letters and digits, single hyphens between",
    },
    "a kebab-case slug: lowercase letters and digits, single hyphens between",
  ],
];

const actuals: ReadonlyArray<readonly [string, unknown, string]> = [
  ["a string", "x", '"x"'],
  ["a string holding a quote", 'a"b', '"a\\"b"'],
  ["an integer", 1, "1"],
  ["a fraction", 1.5, "1.5"],
  ["true", true, "true"],
  ["false", false, "false"],
  ["null", null, "null"],
  ["undefined", undefined, "undefined"],
  ["an empty array", [], "[]"],
  ["an array", [1, "a"], '[1,"a"]'],
  ["an empty object", {}, "{}"],
  ["a nested object", { a: { b: [1, null] } }, '{"a":{"b":[1,null]}}'],
];

const paths: ReadonlyArray<readonly [string, RefusalPath, "bracketed" | "dotted", string]> = [
  ["the root, bracketed", [], "bracketed", ""],
  ["the root, dotted", [], "dotted", ""],
  ["one key, bracketed", ["version"], "bracketed", "version"],
  ["one key, dotted", ["version"], "dotted", "version"],
  ["a leading index, bracketed", [0, "id"], "bracketed", "[0].id"],
  ["a leading index, dotted", [0, "id"], "dotted", "0.id"],
  [
    "keys and indices, bracketed",
    ["acceptanceCriteria", 2, "refs", 0],
    "bracketed",
    "acceptanceCriteria[2].refs[0]",
  ],
  [
    "keys and indices, dotted",
    ["acceptanceCriteria", 2, "refs", 0],
    "dotted",
    "acceptanceCriteria.2.refs.0",
  ],
  ["a key after an index, dotted", ["a", 0, "b"], "dotted", "a.0.b"],
  ["consecutive indices, bracketed", ["grid", 1, 2], "bracketed", "grid[1][2]"],
];

describe("refusalMessage", () => {
  it.each(messages)("renders %s", (_name, refusal, expected) => {
    expect(refusalMessage(refusal)).toBe(expected);
  });
});

describe("formatActual", () => {
  it.each(actuals)("prints %s as Effect 3 printed it", (_name, value, expected) => {
    expect(formatActual(value)).toBe(expected);
  });
});

describe("refusalPath", () => {
  it.each(paths)("renders %s", (_name, path, notation, expected) => {
    expect(refusalPath(path, notation)).toBe(expected);
  });
});
