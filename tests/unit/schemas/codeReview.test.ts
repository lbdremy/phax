import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { codeReviewFileText, readCodeReviewAnswer } from "../../../src/schemas/codeReview.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const STAMP = schemaUrl("code-review", CURRENT_STAMPS["code-review"]);

const finding = {
  severity: "bug",
  file: "src/cli/greet.ts",
  line: 42,
  message: "An empty --name prints Hello, ! instead of being refused.",
  lens: "surface",
  escape: "unexplored-input",
  criterion: null,
  suggestion: "Refuse an empty --name with exit 2.",
};

const answer = (findings: readonly unknown[]): unknown => ({ $schema: STAMP, findings });

function accept(parsed: unknown) {
  const result = readCodeReviewAnswer(parsed);
  if (Either.isLeft(result)) throw new Error(`refused: ${result.left}`);
  return result.right;
}

describe("the code-review answer contract", () => {
  it("accepts a stamped answer and writes $schema first, then the findings", () => {
    const review = accept(answer([finding]));
    const file = JSON.parse(codeReviewFileText(review)) as Record<string, unknown>;
    expect(Object.keys(file)).toEqual(["$schema", "findings"]);
    expect(file["$schema"]).toBe(STAMP);
    expect(file["findings"]).toEqual([finding]);
    expect(file).not.toHaveProperty("version");
  });

  it("keeps a criterion and a file as given, whether or not they exist", () => {
    const odd = { ...finding, criterion: "ac-nope", file: "src/not/in/any/worktree.ts" };
    const file = JSON.parse(codeReviewFileText(accept(answer([odd])))) as {
      findings: Array<Record<string, unknown>>;
    };
    expect(file.findings[0]?.["criterion"]).toBe("ac-nope");
    expect(file.findings[0]?.["file"]).toBe("src/not/in/any/worktree.ts");
  });

  it("keeps the findings in the answer's order", () => {
    const first = { ...finding, line: 1, message: "first" };
    const second = { ...finding, line: 2, message: "second", severity: "info" };
    const file = JSON.parse(codeReviewFileText(accept(answer([first, second])))) as {
      findings: unknown[];
    };
    expect(file.findings).toEqual([first, second]);
  });

  it("accepts an empty findings list and writes it empty", () => {
    const file = JSON.parse(codeReviewFileText(accept(answer([])))) as { findings: unknown[] };
    expect(file.findings).toEqual([]);
  });

  const without = (key: string) => {
    const { [key]: _omitted, ...rest } = finding as Record<string, unknown>;
    return rest;
  };

  const refused: ReadonlyArray<readonly [string, unknown, readonly string[]]> = [
    ["an unknown lens", answer([{ ...finding, lens: "security" }]), ["lens", "security"]],
    ["a missing suggestion", answer([without("suggestion")]), ["suggestion"]],
    ["an extra finding key", answer([{ ...finding, confidence: 0.9 }]), ["confidence"]],
    ["an unknown severity", answer([{ ...finding, severity: "critical" }]), []],
    ["an unknown escape", answer([{ ...finding, escape: "flaky" }]), []],
    ["no $schema", { findings: [] }, ["$schema"]],
    ["another $schema", { $schema: STAMP.replace("code-review", "run-list"), findings: [] }, []],
    ["a version in place of $schema", { version: 1, findings: [] }, ["$schema", "version"]],
    ["no findings key", { $schema: STAMP }, ["findings"]],
    ["an extra top-level key", { $schema: STAMP, findings: [], summary: "x" }, ["summary"]],
    ["findings that is not an array", { $schema: STAMP, findings: {} }, []],
    ["line 0", answer([{ ...finding, line: 0 }]), []],
    ["a fractional line", answer([{ ...finding, line: 4.5 }]), []],
    ["a string line", answer([{ ...finding, line: "42" }]), []],
    ["an empty file", answer([{ ...finding, file: "" }]), []],
    ["an empty message", answer([{ ...finding, message: "" }]), []],
    ["an empty suggestion", answer([{ ...finding, suggestion: "" }]), []],
    ["an empty criterion", answer([{ ...finding, criterion: "" }]), []],
    ["a missing criterion", answer([without("criterion")]), []],
    ["null", null, []],
    ["an array", [], []],
  ];

  it.each(refused)("refuses %s", (_name, parsed, mentions) => {
    const result = readCodeReviewAnswer(parsed);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      for (const word of mentions) expect(result.left).toContain(word);
    }
  });

  it("refuses an unstamped answer naming the missing $schema and the unexpected version", () => {
    const result = readCodeReviewAnswer({ version: 1, findings: [] });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatch(/^\$schema: is missing; version: is unexpected/);
    }
  });
});
