import { describe, expect, it } from "vitest";
import { Either, Schema } from "effect";
import {
  departureMessage,
  parseTestLine,
  readTestStrategyText,
  renderTestLine,
} from "../../src/domain/plan/testLineGrammar.js";
import { TestLineSchema, type TestLine } from "../../src/schemas/testLine.js";

// The settled edge cases of the test line grammar, one per `it`: each asserts
// what `readTestStrategyText` or `parseTestLine` reads, and, where the case
// concerns a value, the schema's refusal of it.

const decode = Schema.decodeUnknownEither(TestLineSchema, { onExcessProperty: "error" });

function line(overrides: Partial<TestLine> = {}): TestLine {
  return {
    guarantee: "the store keeps every entry",
    size: "small",
    technique: "example",
    oracle: "the stored entries",
    loop: "in-phase",
    criterion: null,
    ...overrides,
  };
}

function refused(value: TestLine): boolean {
  return Either.isLeft(decode(value));
}

// The lines of a section, without their item numbers.
function linesOf(text: string): TestLine[] {
  return readTestStrategyText(text).lines.map(({ line: l }) => l);
}

const LS = "\u{2028}";
const PS = "\u{2029}";
const NEL = "\u{85}";

describe("test line grammar", () => {
  it("reads a guarantee holding ' — ' and ' · ' whole", () => {
    const text = "a — b · c holds — small · example · the output · in-phase";
    expect(parseTestLine(text)).toEqual(
      line({ guarantee: "a — b · c holds", oracle: "the output" }),
    );
  });

  it("reads an oracle holding ' · ' whole, with and without a criterion", () => {
    expect(parseTestLine("g — small · table · rows · and columns · oracle")).toEqual(
      line({ guarantee: "g", technique: "table", oracle: "rows · and columns", loop: "oracle" }),
    );
    expect(parseTestLine("g — small · table · rows · and columns · oracle · ac-rows")).toEqual(
      line({
        guarantee: "g",
        technique: "table",
        oracle: "rows · and columns",
        loop: "oracle",
        criterion: "ac-rows",
      }),
    );
  });

  it("departs an oracle holding ' — ', which the schema refuses", () => {
    expect(readTestStrategyText("- g — small · example · a — b · in-phase")).toEqual({
      lines: [],
      departures: [{ line: 1, text: "g — small · example · a — b · in-phase" }],
    });
    expect(refused(line({ oracle: "a — b" }))).toBe(true);
  });

  it("keeps code spans and backticks verbatim, and departs a coordinate in backticks, the criterion included", () => {
    expect(
      parseTestLine("`run()` returns — small · example · `run()`'s `value` · in-phase"),
    ).toEqual(line({ guarantee: "`run()` returns", oracle: "`run()`'s `value`" }));
    for (const text of [
      "g — `small` · example · o · in-phase",
      "g — small · `example` · o · in-phase",
      "g — small · example · o · `in-phase`",
      "g — small · example · o · in-phase · `ac-a`",
    ]) {
      expect(readTestStrategyText(`- ${text}`).departures, text).toEqual([{ line: 1, text }]);
    }
    expect(refused(line({ criterion: "`ac-a`" }))).toBe(true);
  });

  it("refuses an oracle ending in ' ·', and renders and reads awkward oracles back unchanged", () => {
    expect(refused(line({ oracle: "the output ·" }))).toBe(true);
    const awkward = ["a · b", "`x · y`", "the output.", "x", "·", "· leading dot", "a ·· b"];
    for (const oracle of awkward) {
      const value = line({ oracle });
      expect(refused(value), oracle).toBe(false);
      expect(parseTestLine(renderTestLine(value)), oracle).toEqual(value);
      const withCriterion = line({ oracle, criterion: "ac-x" });
      expect(parseTestLine(renderTestLine(withCriterion)), oracle).toEqual(withCriterion);
    }
  });

  it("drops trailing spaces and a two-space hard break, and departs doubled spaces around a separator", () => {
    expect(linesOf("- g — small · example · o · in-phase   \n")).toEqual([
      line({ guarantee: "g", oracle: "o" }),
    ]);
    expect(linesOf("- g — small · example ·  \n  o · in-phase")).toEqual([
      line({ guarantee: "g", oracle: "o" }),
    ]);
    expect(linesOf("- g — small · example · o · in-phase  ")).toEqual([
      line({ guarantee: "g", oracle: "o" }),
    ]);
    for (const text of [
      "g  — small · example · o · in-phase",
      "g — small  · example · o · in-phase",
      "g — small · example ·  o · in-phase",
      "g — small · example · o  · in-phase",
    ]) {
      expect(readTestStrategyText(`- ${text}`).departures, text).toHaveLength(1);
    }
  });

  it("joins a wrapped continuation line with one space, and departs a second paragraph after a blank line as its own item", () => {
    const wrapped =
      "- the store keeps every entry —\n  small · example · the stored entries · in-phase";
    expect(readTestStrategyText(wrapped)).toEqual({
      lines: [{ item: 1, line: line() }],
      departures: [],
    });
    const paragraphs = `${wrapped}\n\n  A second paragraph.`;
    expect(readTestStrategyText(paragraphs)).toEqual({
      lines: [{ item: 1, line: line() }],
      departures: [{ line: 2, text: "A second paragraph." }],
    });
  });

  it.each([
    ["U+2028", LS],
    ["U+2029", PS],
    ["U+0085", NEL],
  ])("departs a line holding %s, and the schema refuses it", (_name, ch) => {
    const text = `- g — small · example · o${ch}p · in-phase`;
    expect(readTestStrategyText(text).lines).toEqual([]);
    expect(readTestStrategyText(text).departures).toHaveLength(1);
    expect(refused(line({ guarantee: `a${ch}b` }))).toBe(true);
    expect(refused(line({ oracle: `a${ch}b` }))).toBe(true);
  });

  it("reads `- (none)` and empty text as no line, and departs `(none)` beside an entry", () => {
    expect(readTestStrategyText("- (none)")).toEqual({ lines: [], departures: [] });
    expect(readTestStrategyText("- None")).toEqual({ lines: [], departures: [] });
    expect(readTestStrategyText("")).toEqual({ lines: [], departures: [] });
    expect(readTestStrategyText("\n  \n")).toEqual({ lines: [], departures: [] });
    expect(readTestStrategyText("- g — small · example · o · in-phase\n- (none)")).toEqual({
      lines: [{ item: 1, line: line({ guarantee: "g", oracle: "o" }) }],
      departures: [{ line: 2, text: "(none)" }],
    });
  });

  it("reads a last field equal to a loop value as the loop, and the schema refuses `oracle` as a criterion", () => {
    expect(parseTestLine("g — small · example · o · oracle")).toEqual(
      line({ guarantee: "g", oracle: "o", loop: "oracle" }),
    );
    expect(parseTestLine("g — small · example · o · in-phase · oracle")).toEqual(
      line({ guarantee: "g", oracle: "o · in-phase", loop: "oracle" }),
    );
    expect(refused(line({ criterion: "oracle" }))).toBe(true);
    expect(refused(line({ criterion: "in-phase" }))).toBe(true);
  });

  it("departs `--` or `-` in place of `—`, and an unknown size", () => {
    for (const text of [
      "g -- small · example · o · in-phase",
      "g - small · example · o · in-phase",
      "g — unit · example · o · in-phase",
    ]) {
      expect(readTestStrategyText(`- ${text}`)).toEqual({
        lines: [],
        departures: [{ line: 1, text }],
      });
    }
  });

  it("departs stray text before the list as line 1, and numbers the entries after it from 2", () => {
    const text = [
      "Write these first:",
      "- g — small · example · o · in-phase",
      "- not a test line",
      "* h — medium · property · p · oracle · ac-h",
    ].join("\n");
    const reading = readTestStrategyText(text);
    expect(reading.departures).toEqual([
      { line: 1, text: "Write these first:" },
      { line: 3, text: "not a test line" },
    ]);
    expect(reading.lines.map(({ item }) => item)).toEqual([2, 4]);
    expect(reading.departures.map(departureMessage)).toEqual([
      'test line 1 departs from the format: "Write these first:"',
      'test line 3 departs from the format: "not a test line"',
    ]);
  });

  it("reads `*` and `+` bullets after up to three spaces", () => {
    expect(
      linesOf("   * g — small · example · o · in-phase\n+ h — large · fuzz · p · oracle"),
    ).toEqual([
      line({ guarantee: "g", oracle: "o" }),
      line({ guarantee: "h", size: "large", technique: "fuzz", oracle: "p", loop: "oracle" }),
    ]);
  });

  it.each([
    ["without a criterion", line()],
    ["with a criterion", line({ criterion: "ac-store" })],
    ["on every coordinate", line({ size: "medium", technique: "metamorphic", loop: "oracle" })],
    ["with a long guarantee", line({ guarantee: "a — b · c — d", oracle: "e · f" })],
  ])("renders and reads back a line %s unchanged", (_label, value) => {
    expect(renderTestLine(value).startsWith("- ")).toBe(false);
    expect(parseTestLine(renderTestLine(value))).toEqual(value);
    expect(readTestStrategyText(`- ${renderTestLine(value)}`).lines).toEqual([
      { item: 1, line: value },
    ]);
  });

  it("renders the criterion suffix only where a line names one", () => {
    expect(renderTestLine(line())).toBe(
      "the store keeps every entry — small · example · the stored entries · in-phase",
    );
    expect(renderTestLine(line({ criterion: "ac-store" }))).toBe(
      "the store keeps every entry — small · example · the stored entries · in-phase · ac-store",
    );
  });
});
