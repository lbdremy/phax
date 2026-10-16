import { describe, it, expect } from "vitest";
import { Either } from "effect";
import {
  locatePlanSections,
  phaseHeadingIds,
  type LocatablePhase,
} from "../../src/domain/plan/sections.js";

const PHASE_01 = `## phase-01 — Parse the widget {#phase-01-parse}

Parse the widget header.

### Planned files to create

- \`src/widget.ts\``;

const PHASE_02 = `## phase-02 — Render the widget {#phase-02-render}

Render the parsed widget.`;

const PREAMBLE = `# Widget plan

The widget plan's shared intent.

## Technical arbitrations

- Widgets render eagerly.`;

const PLAN = `---
status: Approved
source-spec: none
---
${PREAMBLE}

---

${PHASE_01}

---

${PHASE_02}
`;

const PHASES: readonly LocatablePhase[] = [
  { id: "phase-01", planMarkdownAnchor: "#phase-01-parse" },
  { id: "phase-02", planMarkdownAnchor: "#phase-02-render" },
];

function located(planMd: string, phases: readonly LocatablePhase[] = PHASES) {
  const result = locatePlanSections(planMd, phases);
  if (Either.isLeft(result)) throw new Error(`unlocatable: ${result.left.join(", ")}`);
  return result.right;
}

describe("locatePlanSections", () => {
  it("excludes the frontmatter and every phase from the preamble", () => {
    const { preamble } = located(PLAN);
    expect(preamble).toBe(`${PREAMBLE}\n\n---`);
    expect(preamble).not.toContain("status: Approved");
    expect(preamble).not.toContain("phase-01");
    expect(preamble).not.toContain("phase-02");
  });

  it("slices each section verbatim, from its heading to the next", () => {
    const { sections } = located(PLAN);
    expect(sections.get("phase-01")).toBe(`${PHASE_01}\n\n---`);
    expect(sections.get("phase-02")).toBe(PHASE_02);
  });

  it("locates a phase by its anchor when its heading lacks the id", () => {
    const plan = PLAN.replace(
      "## phase-02 — Render the widget {#phase-02-render}",
      "## Step two — Render the widget {#phase-02-render}",
    );
    const { sections } = located(plan);
    expect(sections.get("phase-02")).toBe(PHASE_02.replace("## phase-02 —", "## Step two —"));
  });

  it("accepts an anchor declared with or without a leading #", () => {
    const { sections } = located(PLAN.replace("## phase-02 —", "## Step two —"), [
      PHASES[0]!,
      { id: "phase-02", planMarkdownAnchor: "phase-02-render" },
    ]);
    expect(sections.has("phase-02")).toBe(true);
  });

  it("does not locate a phase from a heading inside a fenced code block", () => {
    const plan = PLAN.replace(
      PHASE_02,
      "```md\n## phase-02 — Render the widget {#phase-02-render}\n```",
    );
    expect(locatePlanSections(plan, PHASES)).toEqual(Either.left(["phase-02"]));
  });

  it("lists a missing phase in the Left", () => {
    const plan = PLAN.replace(PHASE_02, "");
    expect(locatePlanSections(plan, PHASES)).toEqual(Either.left(["phase-02"]));
  });

  it("lists every missing phase in plan order", () => {
    const phases: readonly LocatablePhase[] = [
      { id: "phase-01", planMarkdownAnchor: "#phase-01-parse" },
      { id: "phase-02", planMarkdownAnchor: "#nowhere-two" },
      { id: "phase-03", planMarkdownAnchor: "#phase-03-ship" },
      { id: "phase-04", planMarkdownAnchor: "#nowhere-four" },
    ];
    const plan = PLAN.replace(PHASE_02, "## phase-03 — Ship {#phase-03-ship}\n\nShip it.");
    expect(locatePlanSections(plan, phases)).toEqual(Either.left(["phase-02", "phase-04"]));
  });

  it("keeps a non-phase ## between two phases in the section before it", () => {
    const appendix = "## Appendix\n\nA note about widgets.";
    const plan = PLAN.replace(`${PHASE_01}\n`, `${PHASE_01}\n\n${appendix}\n`);
    const { sections } = located(plan);
    expect(sections.get("phase-01")).toBe(`${PHASE_01}\n\n${appendix}\n\n---`);
    expect(sections.get("phase-02")).toBe(PHASE_02);
  });

  it("does not take a heading already taken by an earlier phase", () => {
    // phase-02's anchor points at phase-01's heading; that heading is taken.
    const phases: readonly LocatablePhase[] = [
      { id: "phase-01", planMarkdownAnchor: "#phase-01-parse" },
      { id: "phase-02", planMarkdownAnchor: "#phase-01-parse" },
    ];
    const plan = PLAN.replace("## phase-02 — Render the widget {#phase-02-render}", "## Other");
    expect(locatePlanSections(plan, phases)).toEqual(Either.left(["phase-02"]));
  });

  it("reads a plan with no frontmatter", () => {
    const { preamble, sections } = located(`${PREAMBLE}\n\n${PHASE_01}\n\n${PHASE_02}\n`);
    expect(preamble).toBe(PREAMBLE);
    expect(sections.get("phase-01")).toBe(PHASE_01);
  });
});

describe("phaseHeadingIds", () => {
  it("returns the phase ids of root ## headings in document order, lowercased", () => {
    const plan = `# Plan

## Required commands

- (none)

## Phase-03 — Third {#c}

\`\`\`md
## phase-09 — In a fence {#z}
\`\`\`

## phase-01 — First {#a}

### phase-05 — Not a depth-2 heading
`;
    expect(phaseHeadingIds(plan)).toEqual(["phase-03", "phase-01"]);
  });

  it("returns nothing for a plan with no phase heading", () => {
    expect(phaseHeadingIds("# Plan\n\n## Required commands\n")).toEqual([]);
  });
});
