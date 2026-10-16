import { describe, expect, it } from "vitest";
import { renderPlanOutline, type OutlinePhase } from "../../src/domain/plan/outline.js";

const phases: readonly (OutlinePhase & { readonly optionalFilesToEdit: readonly string[] })[] = [
  {
    id: "phase-01",
    title: "Add the parser",
    plannedFilesToCreate: ["src/parser.ts", "tests/parser.test.ts"],
    plannedFilesToEdit: ["src/index.ts"],
    optionalFilesToEdit: ["src/optional-one.ts"],
  },
  {
    id: "phase-02",
    title: "Wire the parser",
    plannedFilesToCreate: [],
    plannedFilesToEdit: ["src/cli.ts"],
    optionalFilesToEdit: ["src/optional-two.ts"],
  },
  {
    id: "phase-03",
    title: "Document it",
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
  },
];

describe("renderPlanOutline", () => {
  it("lists every phase with its title and its create and edit paths", () => {
    expect(renderPlanOutline(phases, "phase-02")).toBe(
      [
        "- phase-01 — Add the parser",
        "  create: `src/parser.ts`, `tests/parser.test.ts`",
        "  edit: `src/index.ts`",
        "- phase-02 — Wire the parser ← current phase",
        "  create: (none)",
        "  edit: `src/cli.ts`",
        "- phase-03 — Document it",
        "  create: (none)",
        "  edit: (none)",
      ].join("\n"),
    );
  });

  it("shows (none) for empty lists", () => {
    const outline = renderPlanOutline(phases, "phase-01");
    expect(outline).toContain("- phase-03 — Document it\n  create: (none)\n  edit: (none)");
  });

  it("leaves optional files out", () => {
    const outline = renderPlanOutline(phases, "phase-01");
    expect(outline).not.toContain("optional-one");
    expect(outline).not.toContain("optional-two");
  });

  it("marks exactly the current phase", () => {
    const outline = renderPlanOutline(phases, "phase-03");
    expect(outline.match(/← current phase/g)).toHaveLength(1);
    expect(outline).toContain("- phase-03 — Document it ← current phase");
  });
});
