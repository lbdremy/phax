import { describe, expect, it } from "vitest";
import {
  ADJUST_PLAN_PROMPT_FILENAME,
  buildAdjustPlanPositionalPrompt,
  buildAdjustPlanPrompt,
} from "../../../src/domain/planOverlap/adjustPrompt.js";

const baseInput = {
  planPath: "docs/plans/40-foo.md",
  planMarkdown: "# Plan 40\n\nSome plan content here.",
  landedLabel: "my-feature.phase-01",
  landedChanges: {
    added: ["src/new-file.ts"],
    modified: ["src/existing.ts", "README.md"],
    deletedOrRenamed: ["src/old.ts"],
  },
};

describe("ADJUST_PLAN_PROMPT_FILENAME", () => {
  it("is the expected constant", () => {
    expect(ADJUST_PLAN_PROMPT_FILENAME).toBe("adjust-plan-prompt.md");
  });
});

describe("buildAdjustPlanPrompt", () => {
  it("names the plan path", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("docs/plans/40-foo.md");
  });

  it("names the landed run label", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("my-feature.phase-01");
  });

  it("lists the landed added files", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("src/new-file.ts");
  });

  it("lists the landed modified files", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("src/existing.ts");
    expect(output).toContain("README.md");
  });

  it("lists the landed deleted/renamed files", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("src/old.ts");
  });

  it("includes the establish-drift instruction", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("Establish the drift");
  });

  it("includes the ask-questions instruction", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("Ask clarifying questions");
  });

  it("includes the propose instruction", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("Propose concrete edits");
  });

  it("includes wait-for-approval instruction", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("Wait for explicit approval");
  });

  it("includes apply-only-after-approval instruction", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("Apply only after approval");
  });

  it("embeds the plan markdown", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("# Plan 40");
    expect(output).toContain("Some plan content here.");
  });

  it("does not include an impact section when impact is absent", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).not.toContain("Deterministic impact");
  });

  it("includes the impact section when impact is present", () => {
    const output = buildAdjustPlanPrompt({
      ...baseInput,
      impact: {
        shared: [
          {
            path: "src/existing.ts",
            severity: "medium",
            reason: "both plans edit this source file",
          },
        ],
        severity: "medium",
      },
    });
    expect(output).toContain("Deterministic impact");
    expect(output).toContain("src/existing.ts");
    expect(output).toContain("medium");
    expect(output).toContain("both plans edit this source file");
  });

  it("mentions 'not a gate' to set expectations", () => {
    const output = buildAdjustPlanPrompt(baseInput);
    expect(output).toContain("not a gate");
  });

  it("is stable for fixed input", () => {
    const a = buildAdjustPlanPrompt(baseInput);
    const b = buildAdjustPlanPrompt(baseInput);
    expect(a).toBe(b);
  });

  it("shows (none) when a change list is empty", () => {
    const output = buildAdjustPlanPrompt({
      ...baseInput,
      landedChanges: { added: [], modified: [], deletedOrRenamed: [] },
    });
    expect(output).toContain("(none)");
  });
});

describe("buildAdjustPlanPositionalPrompt", () => {
  it("returns a non-empty string containing the file path", () => {
    const prompt = buildAdjustPlanPositionalPrompt(
      "/tmp/run/adjust-plan-sessions/foo/adjust-plan-prompt.md",
    );
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("/tmp/run/adjust-plan-sessions/foo/adjust-plan-prompt.md");
  });

  it("instructs not to propose or change until the file is read", () => {
    const prompt = buildAdjustPlanPositionalPrompt("/some/path/adjust-plan-prompt.md");
    expect(prompt).toContain("Do not propose or change anything until you have read it");
  });
});
