import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Either } from "effect";
import { extractPlanDeterministic } from "../../src/domain/plan/parsePlanMarkdown.js";

const planMd = readFileSync(
  join(import.meta.dirname, "../../examples/hello-world/plan.md"),
  "utf8",
);

describe("examples/hello-world/plan.md — deterministic extraction regression", () => {
  it("parses without the LLM (Either.right)", () => {
    const result = extractPlanDeterministic(planMd);
    expect(Either.isRight(result)).toBe(true);
  });

  it("extracts the expected phase ids", () => {
    const result = extractPlanDeterministic(planMd);
    if (Either.isLeft(result)) throw result.left;
    expect(result.right.phases.map((p) => p.id)).toEqual(["phase-01", "phase-02", "phase-03"]);
  });

  it("extracts the expected planMarkdownAnchors", () => {
    const result = extractPlanDeterministic(planMd);
    if (Either.isLeft(result)) throw result.left;
    expect(result.right.phases.map((p) => p.planMarkdownAnchor)).toEqual([
      "#phase-01-greet-function",
      "#phase-02-test-greet",
      "#phase-03-document-greet",
    ]);
  });

  it("extracts requiredCommands as an empty array", () => {
    const result = extractPlanDeterministic(planMd);
    if (Either.isLeft(result)) throw result.left;
    expect(result.right.run.requiredCommands).toEqual([]);
  });
});
