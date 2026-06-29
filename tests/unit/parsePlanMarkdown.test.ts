import { describe, it, expect } from "vitest";
import { Either } from "effect";
import { extractPlanDeterministic } from "../../src/domain/plan/parsePlanMarkdown.js";
import { PlanValidationError } from "../../src/domain/errors.js";

function planMd(
  options: {
    title?: string;
    requiredCommands?: string;
    phases: ReadonlyArray<{
      heading: string;
      modelEffort?: string;
      created?: string;
      edited?: string;
      optional?: string;
      commitSubject?: string;
      commitBody?: string;
      extraSections?: string;
    }>;
  } = { phases: [] },
): string {
  const lines: string[] = [];
  lines.push(`# ${options.title ?? "Test plan"}`, "");
  lines.push("## Required commands", "");
  lines.push(options.requiredCommands ?? "- (none)", "");
  for (const p of options.phases) {
    lines.push(`## ${p.heading}`, "");
    lines.push(
      p.modelEffort ?? "**Recommended model:** claude-sonnet-4-6\n**Recommended effort:** medium",
      "",
    );
    if (p.extraSections) lines.push(p.extraSections, "");
    lines.push("### Planned files to create", "");
    lines.push(p.created ?? "- (none)", "");
    lines.push("### Planned files to edit", "");
    lines.push(p.edited ?? "- (none)", "");
    lines.push("### Optional files that may be edited", "");
    lines.push(p.optional ?? "- (none)", "");
    lines.push("### Commit subject", "");
    lines.push(p.commitSubject ?? "feat: do thing", "");
    lines.push("### Commit body", "");
    lines.push(p.commitBody ?? "Does the thing.", "");
  }
  return lines.join("\n");
}

describe("extractPlanDeterministic — conforming plans", () => {
  it("parses a multi-phase plan into the exact expected ExtractedPhaxPlan", () => {
    const md = planMd({
      title: "My Run",
      requiredCommands: "- pnpm test\n- pnpm lint",
      phases: [
        {
          heading: "phase-01 — Alpha {#phase-01-alpha}",
          modelEffort: "**Recommended model:** claude-opus-4-8\n**Recommended effort:** high",
          created: "- src/a.ts\n- tests/a.test.ts",
          edited: "- package.json",
          optional: "- (none)",
          commitSubject: "feat(a): add a",
          commitBody: "Adds a.\n\nMore body.",
        },
        {
          heading: "phase-02 — Beta {#phase-02-beta}",
          created: "- src/b.ts",
          edited: "- (none)",
          optional: "- (none)",
          commitSubject: "feat(b): add b",
          commitBody: "Adds b.",
        },
      ],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    expect(result.right).toEqual({
      version: 1,
      run: {
        shortName: "My Run",
        title: "My Run",
        requiredCommands: ["pnpm test", "pnpm lint"],
      },
      phases: [
        {
          id: "phase-01",
          model: "claude-opus-4-8",
          effort: "high",
          planMarkdownAnchor: "#phase-01-alpha",
          plannedFilesToCreate: ["src/a.ts", "tests/a.test.ts"],
          plannedFilesToEdit: ["package.json"],
          optionalFilesToEdit: [],
          commit: { subject: "feat(a): add a", body: "Adds a.\n\nMore body." },
        },
        {
          id: "phase-02",
          model: "claude-sonnet-4-6",
          effort: "medium",
          planMarkdownAnchor: "#phase-02-beta",
          plannedFilesToCreate: ["src/b.ts"],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat(b): add b", body: "Adds b." },
        },
      ],
    });
  });

  it("treats a single `- (none)` item as an empty list (required commands and all file lists)", () => {
    const md = planMd({
      requiredCommands: "- (none)",
      phases: [
        {
          heading: "phase-01 — Only {#phase-01-only}",
          created: "- (none)",
          edited: "- (none)",
          optional: "- (none)",
        },
      ],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    expect(result.right.run.requiredCommands).toEqual([]);
    expect(result.right.phases[0]!.plannedFilesToCreate).toEqual([]);
    expect(result.right.phases[0]!.plannedFilesToEdit).toEqual([]);
    expect(result.right.phases[0]!.optionalFilesToEdit).toEqual([]);
  });

  it("stores a backtick-wrapped commit subject unwrapped", () => {
    const md = planMd({
      phases: [
        {
          heading: "phase-01 — Wrap {#phase-01-wrap}",
          commitSubject: "`feat(plan): wrapped subject`",
        },
      ],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    expect(result.right.phases[0]!.commit.subject).toBe("feat(plan): wrapped subject");
  });

  it("accepts em-dash, en-dash, and hyphen heading separators", () => {
    for (const sep of ["—", "–", "-"]) {
      const md = planMd({
        phases: [
          {
            heading: `phase-01 ${sep} Title ${sep} extra {#phase-01-sep}`,
          },
        ],
      });
      const result = extractPlanDeterministic(md);
      expect(Either.isRight(result)).toBe(true);
    }
  });
});

describe("extractPlanDeterministic — failure paths", () => {
  it("fails with a phase-scoped message when the model line is missing", () => {
    const md = planMd({
      phases: [
        {
          heading: "phase-01 — NoModel {#phase-01-nomodel}",
          modelEffort: "**Recommended effort:** low",
        },
      ],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) return;
    expect(result.left).toBeInstanceOf(PlanValidationError);
    expect(result.left.message).toContain("phase-01");
    expect(result.left.message).toContain("Recommended model");
  });

  it("fails when the phase heading is missing an {#anchor}", () => {
    const md = planMd({
      phases: [{ heading: "phase-01 — NoAnchor" }],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) return;
    expect(result.left.message).toContain("phase-01");
    expect(result.left.message).toContain("anchor");
  });

  it("fails when a planned-file section is missing", () => {
    const lines = [
      "# Run",
      "",
      "## Required commands",
      "",
      "- (none)",
      "",
      "## phase-01 — Partial {#phase-01-partial}",
      "",
      "**Recommended model:** claude-sonnet-4-6",
      "**Recommended effort:** low",
      "",
      "### Planned files to create",
      "",
      "- (none)",
      "",
      "### Optional files that may be edited",
      "",
      "- (none)",
      "",
      "### Commit subject",
      "",
      "feat: x",
      "",
      "### Commit body",
      "",
      "body",
    ];
    const result = extractPlanDeterministic(lines.join("\n"));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) return;
    expect(result.left.message).toContain("phase-01");
    expect(result.left.message).toContain("Planned files to edit");
  });

  it("fails when effort is not a valid EffortSchema literal", () => {
    const md = planMd({
      phases: [
        {
          heading: "phase-01 — BadEffort {#phase-01-badeffort}",
          modelEffort: "**Recommended model:** claude-sonnet-4-6\n**Recommended effort:** turbo",
        },
      ],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) return;
    expect(result.left).toBeInstanceOf(PlanValidationError);
    expect(result.left.message.toLowerCase()).toContain("schema");
  });
});
