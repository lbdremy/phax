// The lint baseline (scripts/lintBaseline.ts): what a disable directive and an oxlint diagnostic are named
// by, and when the check against lint-baseline.json fails. The command around it is
// scripts/lint-baseline.ts.
import { describe, expect, it } from "vitest";

import {
  DEBT,
  FROZEN,
  UNUSED_DIRECTIVE,
  compare,
  diagnosticsOf,
  directivesOf,
  initialBaseline,
  parseBaseline,
  parseDirective,
  parseReport,
  passes,
  prune,
  renderBaseline,
  renderFailure,
  type Baseline,
  type Diagnostic,
  type Directive,
} from "../../scripts/lintBaseline.js";

const directive = (overrides: Partial<Directive> = {}): Directive => ({
  file: "src/a.ts",
  line: 10,
  kind: "line",
  rules: ["typescript/no-explicit-any"],
  reason: "",
  text: "// oxlint-disable-next-line typescript/no-explicit-any",
  ...overrides,
});

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  file: "src/a.ts",
  line: 20,
  rule: "typescript/no-floating-promises",
  message: "Promises must be awaited",
  ...overrides,
});

const NONE: Baseline = { entries: [] };

describe("parseDirective", () => {
  it("reads the kind, the rules and the reason after ` -- `", () => {
    expect(
      parseDirective(
        " oxlint-disable-next-line unicorn/no-thenable, no-control-regex -- data, never awaited",
      ),
    ).toEqual({
      kind: "line",
      rules: ["unicorn/no-thenable", "no-control-regex"],
      reason: "data, never awaited",
    });
    expect(parseDirective(" eslint-disable-line no-explicit-any")).toEqual({
      kind: "line",
      rules: ["no-explicit-any"],
      reason: "",
    });
    expect(parseDirective(" oxlint-disable typescript/no-explicit-any ")).toEqual({
      kind: "file",
      rules: ["typescript/no-explicit-any"],
      reason: "",
    });
  });

  it("is not an enable, nor a comment that only mentions a directive", () => {
    expect(parseDirective(" oxlint-enable no-explicit-any")).toBeUndefined();
    expect(parseDirective(" see oxlint-disable-next-line in the docs")).toBeUndefined();
    expect(parseDirective(" oxlint-disabled")).toBeUndefined();
  });

  it("names no rule when it silences them all", () => {
    expect(parseDirective(" eslint-disable -- whole file")?.rules).toEqual([]);
  });
});

describe("directivesOf", () => {
  it("gives each directive its line and its text", () => {
    const source =
      "const a = 1;\n\n// oxlint-disable-next-line no-explicit-any -- test\nlet b: any;\n";
    const start = source.indexOf("//");
    const comments = [
      {
        value: " oxlint-disable-next-line no-explicit-any -- test",
        start,
        end: source.indexOf("\nlet"),
      },
    ];
    expect(directivesOf("src/b.ts", source, comments)).toEqual([
      {
        file: "src/b.ts",
        line: 3,
        kind: "line",
        rules: ["no-explicit-any"],
        reason: "test",
        text: "// oxlint-disable-next-line no-explicit-any -- test",
      },
    ]);
  });
});

describe("parseReport and diagnosticsOf", () => {
  it("names a diagnostic by its file and rule, an unused directive by one rule", () => {
    const report = parseReport(
      JSON.stringify({
        number_of_files: 2,
        diagnostics: [
          {
            message: "Unsafe type assertion",
            code: "typescript(no-unsafe-type-assertion)",
            filename: "src/a.ts",
            labels: [{ span: { line: 4 } }],
          },
          { message: "debugger", code: "eslint(no-debugger)", filename: "src/b.ts", labels: [] },
          {
            message: "Unused eslint-disable directive (no problems were reported).",
            filename: "src/c.ts",
            labels: [{ span: { line: 9 } }],
          },
        ],
      }),
    );
    expect(report).toBeDefined();
    expect(diagnosticsOf(report ?? { diagnostics: [], number_of_files: 0 })).toEqual([
      {
        file: "src/a.ts",
        line: 4,
        rule: "typescript/no-unsafe-type-assertion",
        message: "Unsafe type assertion",
      },
      { file: "src/b.ts", line: 0, rule: "no-debugger", message: "debugger" },
      {
        file: "src/c.ts",
        line: 9,
        rule: UNUSED_DIRECTIVE,
        message: "Unused eslint-disable directive (no problems were reported).",
      },
    ]);
  });

  it("is no report when oxlint printed something else", () => {
    expect(parseReport("Failed to find type-aware linter executable")).toBeUndefined();
    expect(parseReport(JSON.stringify({ diagnostics: [{}], number_of_files: 1 }))).toBeUndefined();
  });
});

describe("compare", () => {
  it("passes on what the baseline holds", () => {
    const baseline = initialBaseline([directive()], [diagnostic()], new Set());
    expect(passes(compare([directive()], [diagnostic()], baseline))).toBe(true);
  });

  it("fails on a new directive, even with a reason", () => {
    const comparison = compare([directive({ reason: "a test" })], [], NONE);
    expect(passes(comparison)).toBe(false);
    expect(comparison.unaccepted).toMatchObject([
      { kind: "line", file: "src/a.ts", rule: "typescript/no-explicit-any", found: 1, accepted: 0 },
    ]);
    expect(renderFailure(comparison)).toContain("needs the operator's entry in lint-baseline.json");
  });

  it("fails on a directive without reason the baseline does not hold, and says it gives none", () => {
    const comparison = compare([directive()], [], NONE);
    expect(passes(comparison)).toBe(false);
    expect(renderFailure(comparison)).toContain("src/a.ts:10  // oxlint-disable-next-line");
    expect(renderFailure(comparison)).toContain("[gives no reason]");
  });

  it("holds a directive without reason the baseline accepts as debt", () => {
    const baseline = initialBaseline([directive()], [], new Set());
    expect(baseline.entries).toEqual([
      {
        kind: "line",
        file: "src/a.ts",
        rule: "typescript/no-explicit-any",
        count: 1,
        reason: DEBT,
      },
    ]);
    expect(passes(compare([directive()], [], baseline))).toBe(true);
  });

  it("fails on a new diagnostic, a floating promise among them", () => {
    const comparison = compare([], [diagnostic()], NONE);
    expect(comparison.unaccepted).toMatchObject([
      { kind: "diagnostic", rule: "typescript/no-floating-promises", found: 1, accepted: 0 },
    ]);
    expect(renderFailure(comparison)).toContain("Fix the code.");
  });

  it("fails on an unused directive", () => {
    const unused = diagnostic({
      rule: UNUSED_DIRECTIVE,
      message: "Unused oxlint-disable directive",
    });
    const baseline = initialBaseline([directive()], [], new Set());
    const comparison = compare([directive()], [unused], baseline);
    expect(passes(comparison)).toBe(false);
    expect(comparison.unaccepted).toMatchObject([{ kind: "diagnostic", rule: UNUSED_DIRECTIVE }]);
  });

  it("fails on a stale entry", () => {
    const baseline = initialBaseline([directive()], [diagnostic()], new Set());
    const comparison = compare([], [diagnostic()], baseline);
    expect(passes(comparison)).toBe(false);
    expect(comparison.stale).toMatchObject([
      { entry: { kind: "line", rule: "typescript/no-explicit-any" }, found: 0 },
    ]);
    expect(renderFailure(comparison)).toContain("pnpm lint --prune");
  });

  it("fails when a count goes up", () => {
    const baseline = initialBaseline([directive()], [], new Set());
    const comparison = compare([directive(), directive({ line: 30 })], [], baseline);
    expect(comparison.unaccepted).toMatchObject([{ found: 2, accepted: 1 }]);
    expect(comparison.unaccepted[0]?.occurrences.map((occurrence) => occurrence.line)).toEqual([
      10, 30,
    ]);
  });

  it("holds a count that goes down as stale until it is pruned", () => {
    const baseline = initialBaseline([], [diagnostic(), diagnostic({ line: 40 })], new Set());
    const comparison = compare([], [diagnostic()], baseline);
    expect(comparison.unaccepted).toEqual([]);
    expect(comparison.stale).toMatchObject([{ entry: { count: 2 }, found: 1 }]);
    const pruned = prune(baseline, [], [diagnostic()]);
    expect(pruned.entries).toMatchObject([{ count: 1 }]);
    expect(passes(compare([], [diagnostic()], pruned))).toBe(true);
  });

  it("never reads the line", () => {
    const baseline = initialBaseline(
      [directive({ line: 3 })],
      [diagnostic({ line: 5 })],
      new Set(),
    );
    expect(passes(compare([directive({ line: 300 })], [diagnostic({ line: 500 })], baseline))).toBe(
      true,
    );
  });

  it("tells a line directive from a whole-file one", () => {
    const baseline = initialBaseline([directive()], [], new Set());
    expect(passes(compare([directive({ kind: "file" })], [], baseline))).toBe(false);
  });

  it("fails on an entry with an empty reason", () => {
    const baseline: Baseline = {
      entries: [
        {
          kind: "line",
          file: "src/a.ts",
          rule: "typescript/no-explicit-any",
          count: 1,
          reason: " ",
        },
      ],
    };
    const comparison = compare([directive()], [], baseline);
    expect(comparison.unreasoned).toHaveLength(1);
    expect(passes(comparison)).toBe(false);
  });

  it("fails on a directive that names no rule, whatever the baseline holds", () => {
    const comparison = compare([directive({ rules: [], text: "/* eslint-disable */" })], [], NONE);
    expect(comparison.ruleless).toHaveLength(1);
    expect(passes(comparison)).toBe(false);
  });
});

describe("prune", () => {
  it("never adds an entry nor raises a count", () => {
    const baseline = initialBaseline([directive()], [], new Set());
    const more = [directive(), directive({ line: 30 }), directive({ file: "src/new.ts" })];
    const pruned = prune(baseline, more, [diagnostic()]);
    expect(pruned).toEqual(baseline);
    expect(passes(compare(more, [diagnostic()], pruned))).toBe(false);
  });

  it("drops an entry nothing matches any more", () => {
    const baseline = initialBaseline([directive()], [diagnostic()], new Set());
    expect(prune(baseline, [], [diagnostic()]).entries).toMatchObject([{ kind: "diagnostic" }]);
  });
});

describe("initialBaseline", () => {
  it("takes the directive's own reason, and the frozen one in a frozen module", () => {
    const baseline = initialBaseline(
      [
        directive({ reason: "given/when/then data", rules: ["unicorn/no-thenable"] }),
        directive({ file: "src/schemas/history/x.ts", rules: ["no-control-regex"] }),
      ],
      [diagnostic({ file: "src/schemas/history/x.ts", rule: UNUSED_DIRECTIVE })],
      new Set(["src/schemas/history/x.ts"]),
    );
    expect(baseline.entries.map(({ file, kind, reason }) => [file, kind, reason])).toEqual([
      ["src/a.ts", "line", "given/when/then data"],
      ["src/schemas/history/x.ts", "line", FROZEN],
      ["src/schemas/history/x.ts", "diagnostic", FROZEN],
    ]);
  });
});

describe("the baseline file", () => {
  it("reads back what it writes", () => {
    const baseline = initialBaseline([directive()], [diagnostic(), diagnostic()], new Set());
    expect(parseBaseline(renderBaseline(baseline))).toEqual(baseline);
  });

  it("refuses an entry without a count, of another kind, or repeated", () => {
    const entry = { kind: "line", file: "src/a.ts", rule: "r", count: 1, reason: DEBT };
    expect(() => parseBaseline(JSON.stringify({ entries: [{ ...entry, count: 0 }] }))).toThrow(
      "count",
    );
    expect(() => parseBaseline(JSON.stringify({ entries: [{ ...entry, kind: "range" }] }))).toThrow(
      "kind",
    );
    expect(() => parseBaseline(JSON.stringify({ entries: [entry, entry] }))).toThrow("repeats");
  });
});
