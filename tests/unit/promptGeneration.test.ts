import { describe, expect, it } from "vitest";
import { buildPhasePrompt } from "../../src/app/promptGeneration.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";

const samplePhase: PhaxPlanPhase = {
  id: "phase-01",
  title: "CLI skeleton",
  model: "claude-sonnet-4-6",
  effort: "medium",
  planMarkdownAnchor: "#phase-01-cli-skeleton",
  plannedFilesToCreate: [],
  plannedFilesToEdit: [],
  optionalFilesToEdit: [],
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
  },
  phases: [samplePhase],
};

const sampleGateCommands: string[] = ["npm run typecheck", "npm run test"];

describe("buildPhasePrompt", () => {
  it("contains the execute-phase heading", () => {
    const prompt = buildPhasePrompt({
      planMd: "# My Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      gateCommands: sampleGateCommands,
    });
    expect(prompt).toContain("# Execute one implementation phase");
  });

  it("includes the plan markdown content", () => {
    const prompt = buildPhasePrompt({
      planMd: "## Custom Plan Content",
      planJson: samplePlan,
      currentPhase: samplePhase,
      gateCommands: sampleGateCommands,
    });
    expect(prompt).toContain("## Custom Plan Content");
  });

  it("includes the serialized plan JSON", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      gateCommands: sampleGateCommands,
    });
    expect(prompt).toContain('"shortName": "my-run"');
  });

  it("includes the current phase JSON", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      gateCommands: sampleGateCommands,
    });
    expect(prompt).toContain('"id": "phase-01"');
    expect(prompt).toContain('"title": "CLI skeleton"');
  });

  it("uses (no previous phase) when previousHandoff is absent", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      gateCommands: sampleGateCommands,
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
      gateCommands: sampleGateCommands,
    });
    expect(prompt).toContain("Phase 00 is done.");
    expect(prompt).not.toContain("(no previous phase)");
  });

  it("includes required output instructions", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      gateCommands: sampleGateCommands,
    });
    expect(prompt).toContain("summary.md");
    expect(prompt).toContain("phase-handoff.md");
  });

  it("includes scope-restriction rules", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      gateCommands: sampleGateCommands,
    });
    expect(prompt).toContain("Do not broaden the scope");
    expect(prompt).toContain("Do not add speculative features");
  });

  it("produces the same output for the same inputs (deterministic)", () => {
    const opts = {
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      gateCommands: sampleGateCommands,
    };
    expect(buildPhasePrompt(opts)).toBe(buildPhasePrompt(opts));
  });

  it("includes the deviation explanation instruction", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      gateCommands: sampleGateCommands,
    });
    expect(prompt).toContain("planned file was not touched");
    expect(prompt).toContain("phase-handoff.md");
  });

  it("does not include the reconciliation section when previousReconciliation is absent", () => {
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      gateCommands: sampleGateCommands,
    });
    expect(prompt).not.toContain("## Previous phase file reconciliation");
  });

  it("includes the reconciliation section when previousReconciliation is provided", () => {
    const reconciliation = "## PHAX File Reconciliation\n\nNo deviations.";
    const prompt = buildPhasePrompt({
      planMd: "# Plan",
      planJson: samplePlan,
      currentPhase: samplePhase,
      previousReconciliation: reconciliation,
      gateCommands: sampleGateCommands,
    });
    expect(prompt).toContain("## Previous phase file reconciliation");
    expect(prompt).toContain("No deviations.");
  });

  it("matches the expected snapshot", () => {
    const prompt = buildPhasePrompt({
      planMd: "# My Plan\n\nPhase overview.",
      planJson: samplePlan,
      currentPhase: samplePhase,
      previousHandoff: "# Phase handoff\n\n## Phase completed\n\nAll done.",
      gateCommands: sampleGateCommands,
    });
    expect(prompt).toMatchSnapshot();
  });
});
