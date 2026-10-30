// The phax-plan-extraction answer: the plan the fallback model extracted, or why
// it found the plan incomplete, exactly one of the two. A refusal names every
// root-level issue, `$schema` first.
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { readPlanExtractionAnswer } from "../../../src/schemas/planExtraction.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const STAMP = schemaUrl("phax-plan-extraction", CURRENT_STAMPS["phax-plan-extraction"]);

const phase = {
  id: "phase-01",
  model: "claude-sonnet-5-5",
  effort: "medium",
  planMarkdownAnchor: "#phase-01-first",
  plannedFilesToCreate: [],
  plannedFilesToEdit: [],
  optionalFilesToEdit: [],
  testLines: [],
  commit: { subject: "feat: x", body: "Body." },
};

const plan = {
  run: { shortName: "my-run", title: "My Run", requiredCommands: [] },
  phases: [phase],
};

function refusal(parsed: unknown): string {
  const read = readPlanExtractionAnswer(parsed);
  if (Either.isRight(read)) throw new Error(`accepted: ${JSON.stringify(read.right)}`);
  return read.left;
}

describe("readPlanExtractionAnswer", () => {
  it("reads a plan, with incomplete null", () => {
    const read = readPlanExtractionAnswer({ $schema: STAMP, plan, incomplete: null });
    expect(read).toEqual(Either.right({ kind: "plan", plan }));
  });

  it("reads an incomplete report, with plan null", () => {
    const read = readPlanExtractionAnswer({
      $schema: STAMP,
      plan: null,
      incomplete: "phase-02 has no commit subject",
    });
    expect(read).toEqual(
      Either.right({ kind: "incomplete", reason: "phase-02 has no commit subject" }),
    );
  });

  it.each([
    ["both set", { $schema: STAMP, plan, incomplete: "something" }],
    ["both null", { $schema: STAMP, plan: null, incomplete: null }],
  ])("refuses an answer with %s by the coherence check", (_name, parsed) => {
    expect(refusal(parsed)).toBe("plan and incomplete: exactly one of them is null");
  });

  it("refuses an answer with version and no $schema, naming both", () => {
    const text = refusal({ version: 1, run: plan.run, phases: plan.phases });
    expect(text).toMatch(/^\$schema: is missing; /);
    expect(text).toContain("version: is unexpected");
    expect(text).toContain("plan: is missing");
  });

  it("refuses another format's $schema", () => {
    const text = refusal({
      $schema: STAMP.replace("phax-plan-extraction", "code-review"),
      plan,
      incomplete: null,
    });
    expect(text).toMatch(/^\$schema: /);
  });

  it("refuses an empty incomplete reason", () => {
    expect(refusal({ $schema: STAMP, plan: null, incomplete: "" })).toContain("incomplete");
  });

  it("refuses a plan with no phase, naming the path", () => {
    const text = refusal({ $schema: STAMP, plan: { ...plan, phases: [] }, incomplete: null });
    expect(text).toContain("plan.phases");
  });

  it("refuses a phase carrying mode, which phax reads itself", () => {
    const text = refusal({
      $schema: STAMP,
      plan: { ...plan, phases: [{ ...phase, mode: "headless" }] },
      incomplete: null,
    });
    expect(text).toContain("mode");
  });

  it("refuses an extra root key", () => {
    expect(refusal({ $schema: STAMP, plan, incomplete: null, summary: "x" })).toContain("summary");
  });

  it.each([null, [], "text", 3])("refuses the non-object %j", (parsed) => {
    expect(Either.isLeft(readPlanExtractionAnswer(parsed))).toBe(true);
  });
});
