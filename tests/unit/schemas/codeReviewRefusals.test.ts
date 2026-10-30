// How a refused code-review answer reads: a value outside a closed set names
// itself and the whole set, and a bad line says what it must be.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { readCodeReviewAnswer } from "../../../src/schemas/codeReview.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const finding = (overrides: Record<string, unknown> = {}) => ({
  severity: "bug",
  file: "src/a.ts",
  line: 3,
  message: "m",
  lens: "edge",
  escape: "omission",
  criterion: null,
  suggestion: "s",
  ...overrides,
});

const refusal = (overrides: Record<string, unknown>) => {
  const read = readCodeReviewAnswer({
    $schema: schemaUrl("code-review", CURRENT_STAMPS["code-review"]),
    findings: [finding(overrides)],
  });
  return Either.isLeft(read) ? read.left : undefined;
};

describe("code-review answer refusals", () => {
  it.each([
    [
      { lens: "security" },
      'findings[0].lens: "security" is not a lens (expected one of surface, acceptance, boundary, core, edge, tests, architecture, docs)',
    ],
    [
      { escape: "flaky" },
      'findings[0].escape: "flaky" is not an escape (expected one of wrong-oracle, same-author, weakened, fake-drift, unexplored-input, omission, untestable)',
    ],
    [
      { severity: "style" },
      'findings[0].severity: "style" is not a severity (expected one of bug, deviation, concern, info)',
    ],
    [{ line: 0 }, "findings[0].line: must be a positive integer, actual 0"],
  ])("%j reads %s", (overrides, expected) => {
    expect(refusal(overrides)).toBe(expected);
  });
});
