import { describe, expect, it } from "vitest";
import { describeFindingCounts } from "../../../src/domain/review/codeReviewFindings.js";

const of = (...severities: Array<"bug" | "deviation" | "concern" | "info">) =>
  severities.map((severity) => ({ severity }));

describe("describeFindingCounts", () => {
  it.each([
    [of("concern", "bug"), "2 findings (1 bug, 1 concern)"],
    [of("info"), "1 finding (1 info)"],
    [of(), "0 findings"],
    [of("info", "info", "deviation", "bug", "bug"), "5 findings (2 bug, 1 deviation, 2 info)"],
  ])("reads %j as %s", (findings, expected) => {
    expect(describeFindingCounts(findings)).toBe(expected);
  });
});
