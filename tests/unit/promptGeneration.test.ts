import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { buildPhasePrompt } from "../../src/app/promptGeneration.js";
import { locatePlanSections } from "../../src/domain/plan/sections.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";

function phase(n: number, title: string, files: Partial<PhaxPlanPhase> = {}): PhaxPlanPhase {
  const id = `phase-0${n}`;
  return {
    id,
    title,
    model: "claude-sonnet-4-6",
    effort: "medium",
    planMarkdownAnchor: `#${id}-made-up`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode: "headless",
    oracle: null,
    commit: {
      subject: `feat: ${title.toLowerCase()}`,
      body: `Commit body of ${id}.`,
    },
    ...files,
  };
}

const phases: PhaxPlan["phases"] = [
  phase(1, "Add the parser", { plannedFilesToCreate: ["src/parser.ts"] }),
  phase(2, "Wire the parser", { plannedFilesToEdit: ["src/cli.ts"] }),
  phase(3, "Report errors", {
    model: "claude-opus-4-6",
    effort: "high",
    plannedFilesToCreate: ["src/report.ts"],
    plannedFilesToEdit: ["src/cli.ts"],
    optionalFilesToEdit: ["src/optional.ts"],
  }),
  phase(4, "Document it", { plannedFilesToEdit: ["README.md"] }),
];

const samplePlan: PhaxPlan = {
  run: {
    shortName: "my-run",
    title: "My Run",
    branch: "feature/my-run",
    requiredCommands: [],
  },
  phases,
};

const PLAN_MD = [
  "---",
  "status: Approved",
  "---",
  "# My Run",
  "",
  "Shared preamble line.",
  "",
  "## Technical arbitrations",
  "",
  "- A made-up arbitration.",
  "",
  ...phases.flatMap((p) => [
    `## ${p.id} — ${p.title} {${p.planMarkdownAnchor}}`,
    "",
    `Instruction line of ${p.id}.`,
    "",
  ]),
].join("\n");

const located = locatePlanSections(PLAN_MD, samplePlan.phases);
if (Either.isLeft(located)) throw new Error(`fixture plan.md is unlocatable: ${located.left}`);
const planSections = located.right;

const phase03 = phases[2]!;

function sectionOf(p: PhaxPlanPhase): string {
  return planSections.sections.get(p.id)!;
}

const sampleGateCommands: string[] = ["npm run typecheck", "npm run test"];

const base = {
  planPreamble: planSections.preamble,
  phaseSection: sectionOf(phase03),
  plan: samplePlan,
  currentPhase: phase03,
  gateCommands: sampleGateCommands,
};

describe("buildPhasePrompt", () => {
  it("contains the execute-phase heading", () => {
    expect(buildPhasePrompt(base)).toContain("# Execute one implementation phase");
  });

  it("carries the preamble and its own section verbatim, and no other phase's instructions", () => {
    const prompt = buildPhasePrompt(base);
    expect(prompt).toContain(planSections.preamble);
    expect(prompt).toContain(sectionOf(phase03));
    expect(prompt).toContain("Instruction line of phase-03.");
    for (const id of ["phase-01", "phase-02", "phase-04"]) {
      expect(prompt).not.toContain(`Instruction line of ${id}.`);
    }
    expect(prompt).not.toContain("status: Approved");
  });

  it("has no whole-plan sections and no other phase's commit body", () => {
    const prompt = buildPhasePrompt(base);
    expect(prompt).not.toContain("## Machine-readable execution plan");
    expect(prompt).not.toContain("## Human-readable approved plan");
    for (const id of ["phase-01", "phase-02", "phase-04"]) {
      expect(prompt).not.toContain(`Commit body of ${id}.`);
    }
  });

  it("carries the current phase's definition", () => {
    const prompt = buildPhasePrompt(base);
    expect(prompt).toContain(`## Current phase\n\n${JSON.stringify(phase03, null, 2)}\n`);
    expect(prompt).toContain('"src/report.ts"');
    expect(prompt).toContain('"subject": "feat: report errors"');
    expect(prompt).toContain('"body": "Commit body of phase-03."');
    expect(prompt).toContain('"model": "claude-opus-4-6"');
    expect(prompt).toContain('"effort": "high"');
  });

  it("outlines every phase and marks the current one", () => {
    const prompt = buildPhasePrompt(base);
    const outline = prompt.slice(
      prompt.indexOf("## Plan outline"),
      prompt.indexOf("## Approved plan: current phase"),
    );
    expect(outline).toContain("- phase-01 — Add the parser\n");
    expect(outline).toContain("- phase-02 — Wire the parser\n");
    expect(outline).toContain("- phase-03 — Report errors ← current phase\n");
    expect(outline).toContain("- phase-04 — Document it\n");
    expect(outline.match(/← current phase/g)).toHaveLength(1);
  });

  it("names .phax-context/plan.md", () => {
    expect(buildPhasePrompt(base)).toContain(
      "The full plan is at `.phax-context/plan.md`; read it only when this phase needs another phase's detail.",
    );
  });

  it("orders its sections", () => {
    const prompt = buildPhasePrompt(base);
    const headings = [
      "## Source intent/spec document",
      "## Approved plan: shared preamble",
      "## Plan outline",
      "## Approved plan: current phase",
      "## Previous phase handoff",
      "## Current phase\n",
      "## Execution rules",
      "## Required output",
    ];
    const offsets = headings.map((h) => prompt.indexOf(h));
    expect(offsets.every((o) => o >= 0)).toBe(true);
    expect(offsets).toEqual(offsets.toSorted((a, b) => a - b));
  });

  it("names the six items the next phase is given in Required output", () => {
    const prompt = buildPhasePrompt(base);
    const requiredOutput = prompt.slice(prompt.indexOf("## Required output"));
    expect(requiredOutput).toContain(
      [
        "- the plan preamble;",
        "- its own section of the plan;",
        "- the plan outline;",
        "- `.phax-context/plan.md`, the full plan;",
        "- its phase definition;",
        "- this `phase-handoff.md`.",
      ].join("\n"),
    );
    expect(prompt).not.toContain("phax-plan.json");
  });

  it("uses (no previous phase) when previousHandoff is absent", () => {
    expect(buildPhasePrompt(base)).toContain("(no previous phase)");
  });

  it("injects the previousHandoff content when provided", () => {
    const handoff = "## Phase completed\n\nPhase 00 is done.";
    const prompt = buildPhasePrompt({ ...base, previousHandoff: handoff });
    expect(prompt).toContain("Phase 00 is done.");
    expect(prompt).not.toContain("(no previous phase)");
  });

  it("includes required output instructions", () => {
    const prompt = buildPhasePrompt(base);
    expect(prompt).toContain("summary.md");
    expect(prompt).toContain("phase-handoff.md");
  });

  it("includes scope-restriction rules", () => {
    const prompt = buildPhasePrompt(base);
    expect(prompt).toContain("Do not broaden the scope");
    expect(prompt).toContain("Do not add speculative features");
  });

  it("produces the same output for the same inputs (deterministic)", () => {
    expect(buildPhasePrompt(base)).toBe(buildPhasePrompt(base));
  });

  it("includes the deviation explanation instruction", () => {
    const prompt = buildPhasePrompt(base);
    expect(prompt).toContain("planned file was not touched");
    expect(prompt).toContain("phase-handoff.md");
  });

  it("does not include the reconciliation section when previousReconciliation is absent", () => {
    expect(buildPhasePrompt(base)).not.toContain("## Previous phase file reconciliation");
  });

  it("includes the reconciliation section when previousReconciliation is provided", () => {
    const reconciliation = "## PHAX File Reconciliation\n\nNo deviations.";
    const prompt = buildPhasePrompt({ ...base, previousReconciliation: reconciliation });
    expect(prompt).toContain("## Previous phase file reconciliation");
    expect(prompt).toContain("No deviations.");
  });

  it("places the brief section between the current phase JSON and the execution rules", () => {
    const briefSection = "## Brief for this phase\n\nA made-up brief.";
    const prompt = buildPhasePrompt({ ...base, briefSection });
    expect(prompt).toContain(
      `${JSON.stringify(phase03, null, 2)}\n\n${briefSection}\n\n## Execution rules\n`,
    );
  });

  it("is byte-identical without a brief section", () => {
    const prompt = buildPhasePrompt({ ...base, briefSection: undefined });
    expect(prompt).toBe(buildPhasePrompt(base));
    expect(prompt).not.toContain("## Brief for this phase");
    expect(prompt).toContain(`${JSON.stringify(phase03, null, 2)}\n\n## Execution rules\n`);
  });

  it("matches the expected snapshot", () => {
    const prompt = buildPhasePrompt({
      ...base,
      previousHandoff: "# Phase handoff\n\n## Phase completed\n\nAll done.",
    });
    expect(prompt).toMatchSnapshot();
  });
});
