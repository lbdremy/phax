import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Result } from "effect";
import { extractPlanDeterministic } from "../../src/domain/plan/parsePlanMarkdown.js";

const EXAMPLE_PLAN_PATH = resolve(
  new URL(".", import.meta.url).pathname,
  "../../examples/hello-world/plan.md",
);

describe("examples/hello-world/plan.md — deterministic extraction", () => {
  it("parses without the LLM", () => {
    const planMd = readFileSync(EXAMPLE_PLAN_PATH, "utf8");
    const result = extractPlanDeterministic(planMd);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) throw new Error(result.failure.message);
    const plan = result.success;

    expect(plan.run.requiredCommands).toEqual([]);
    expect(plan.phases).toHaveLength(3);

    const ids = plan.phases.map((p) => p.id);
    expect(ids).toEqual(["phase-01", "phase-02", "phase-03"]);

    const anchors = plan.phases.map((p) => p.planMarkdownAnchor);
    expect(anchors).toEqual([
      "#phase-01-greet-function",
      "#phase-02-test-greet",
      "#phase-03-document-greet",
    ]);
  });
});
