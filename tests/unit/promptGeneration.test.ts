import { describe, expect, it } from "vitest";
import { buildPhasePrompt } from "../../src/app/promptGeneration.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";

const samplePhase: PhaxPlanPhase = {
  id: "phase-01",
  title: "CLI skeleton",
  model: "claude-sonnet-4-6",
  effort: "medium",
  planMarkdownAnchor: "#phase-01-cli-skeleton",
  commit: {
    subject: "ai(phase-01): create cli skeleton",
    body: "Bootstrap the project.",
  },
};

const samplePlan: PhaxPlan = {
  version: 1,
  run: {
    shortName: "my-run",
    title: "My Run",
    branch: "feature/my-run",
    backend: "claude-code-cli",
  },
  phases: [samplePhase],
};

describe("buildPhasePrompt", () => {
  it("contains the execute-phase heading", () => {
    const prompt = buildPhasePrompt({
      planMd: "# My Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
    });
    expect(prompt).toContain("# Execute one implementation phase");
  });

  it("includes the plan markdown content", () => {
    const prompt = buildPhasePrompt({
      planMd: "## Custom Plan Content",
      planJson: samplePlan,
      currentPhase: samplePhase,
    });
    expect(prompt).toContain("## Custom Plan Content");
  });

  it("includes the serialized plan JSON", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
    });
    expect(prompt).toContain('"shortName": "my-run"');
  });

  it("includes the current phase JSON", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
    });
    expect(prompt).toContain('"id": "phase-01"');
    expect(prompt).toContain('"title": "CLI skeleton"');
  });

  it("uses (no previous phase) when previousHandoff is absent", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
    });
    expect(prompt).toContain("(no previous phase)");
  });

  it("injects the previousHandoff content when provided", () => {
    const handoff = "## Phase completed\n\nPhase 00 is done.";
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      previousHandoff: handoff,
    });
    expect(prompt).toContain("Phase 00 is done.");
    expect(prompt).not.toContain("(no previous phase)");
  });

  it("includes required output instructions", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
    });
    expect(prompt).toContain("summary.md");
    expect(prompt).toContain("phase-handoff.md");
  });

  it("includes scope-restriction rules", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
    });
    expect(prompt).toContain("Do not broaden the scope");
    expect(prompt).toContain("Do not add speculative features");
  });

  it("produces the same output for the same inputs (deterministic)", () => {
    const opts = { planMd: "# Plan", planJson: samplePlan, currentPhase: samplePhase };
    expect(buildPhasePrompt(opts)).toBe(buildPhasePrompt(opts));
  });

  it("matches the expected snapshot", () => {
    const prompt = buildPhasePrompt({
      planMd: "# My Plan\n\nPhase overview.",
      planJson: samplePlan,
      currentPhase: samplePhase,
      previousHandoff: "# Phase handoff\n\n## Phase completed\n\nAll done.",
    });
    expect(prompt).toMatchSnapshot();
  });
});
