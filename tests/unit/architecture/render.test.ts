import { describe, expect, it } from "vitest";
import {
  renderArchitectureReport,
  renderAssignmentBounds,
} from "../../../src/domain/architecture/render.js";
import type { ArchitectureReport } from "../../../src/schemas/architecture.js";
import type { Assignments } from "../../../src/schemas/assignments.js";

const PARTS: ArchitectureReport["parts"] = [
  {
    id: "core-decide",
    name: "core · decide",
    description: "The pure decision logic.",
    globs: ["src/core/decide/**"],
  },
  {
    id: "http-requests",
    name: "http · requests",
    description: "Request handlers.",
    globs: ["src/http/**", "src/*/schemas/**"],
  },
  { id: "docs", name: "docs", description: "The docs.", globs: ["docs/**"] },
];

describe("renderArchitectureReport", () => {
  it("is exactly the body when there are no parts", () => {
    expect(renderArchitectureReport({ body: "# Architecture — acme-billing", parts: [] })).toBe(
      "# Architecture — acme-billing",
    );
  });

  it("renders the body, then each part in order", () => {
    expect(renderArchitectureReport({ body: "# Architecture — acme-billing", parts: PARTS })).toBe(
      [
        "# Architecture — acme-billing",
        "",
        "## Parts",
        "",
        "### core · decide (`core-decide`)",
        "The pure decision logic.",
        "- `src/core/decide/**`",
        "",
        "### http · requests (`http-requests`)",
        "Request handlers.",
        "- `src/http/**`",
        "- `src/*/schemas/**`",
        "",
        "### docs (`docs`)",
        "The docs.",
        "- `docs/**`",
      ].join("\n"),
    );
  });

  it("strips the body's trailing newlines", () => {
    expect(renderArchitectureReport({ body: "# A\n\n\n", parts: [] })).toBe("# A");
    expect(renderArchitectureReport({ body: "# A\n\n", parts: [PARTS[2]!] })).toBe(
      "# A\n\n## Parts\n\n### docs (`docs`)\nThe docs.\n- `docs/**`",
    );
  });

  it("folds a name or description onto one line", () => {
    const out = renderArchitectureReport({
      body: "# A",
      parts: [{ ...PARTS[2]!, name: "do\ncs", description: "The\n\n## Fake\ndocs." }],
    });
    expect(out).toBe("# A\n\n## Parts\n\n### do cs (`docs`)\nThe ## Fake docs.\n- `docs/**`");
  });
});

describe("renderAssignmentBounds", () => {
  const HEADING = "## Bounds (phax.json `assignments`; the first match governs)";
  const BOUNDS: Assignments = [
    {
      kind: "part",
      part: "core-decide",
      model: "claude-opus-5-5",
      effort: { min: "medium", max: "high" },
    },
    {
      kind: "globs",
      globs: ["src/*/schemas/**"],
      model: "claude-sonnet-5-5",
      effort: { min: "medium", max: "high" },
    },
  ];
  const REPORT: ArchitectureReport = { body: "# A", parts: PARTS };

  it("lists each bound in order, a part bound with its part's name and globs", () => {
    expect(renderAssignmentBounds(BOUNDS, { kind: "report", report: REPORT, scoped: false })).toBe(
      [
        HEADING,
        "- assignments[0] part core-decide — core · decide (`src/core/decide/**`): claude-opus-5-5, medium–high",
        "- assignments[1] globs `src/*/schemas/**`: claude-sonnet-5-5, medium–high",
      ].join("\n"),
    );
  });

  it("joins several globs with a comma", () => {
    const out = renderAssignmentBounds(
      [
        { kind: "part", part: "http-requests", model: "m", effort: { min: "low", max: "low" } },
        { kind: "globs", globs: ["a/**", "b/**"], model: "m", effort: { min: "low", max: "low" } },
      ],
      { kind: "report", report: REPORT, scoped: false },
    );
    expect(out).toContain("http · requests (`src/http/**`, `src/*/schemas/**`)");
    expect(out).toContain("globs `a/**`, `b/**`");
  });

  it("prints one effort when min equals max", () => {
    const out = renderAssignmentBounds(
      [{ kind: "globs", globs: ["docs/**"], model: "m", effort: { min: "high", max: "high" } }],
      { kind: "no-provider" },
    );
    expect(out).toBe(`${HEADING}\n- assignments[0] globs \`docs/**\`: m, high`);
  });

  it("marks a part bound unresolved with no provider", () => {
    expect(renderAssignmentBounds(BOUNDS, { kind: "no-provider" })).toBe(
      [
        HEADING,
        "- assignments[0] part core-decide — (unresolved: no architecture provider): claude-opus-5-5, medium–high",
        "- assignments[1] globs `src/*/schemas/**`: claude-sonnet-5-5, medium–high",
      ].join("\n"),
    );
  });

  it("says a scoped report that lacks the part is not the whole picture", () => {
    const report: ArchitectureReport = { body: "# A", parts: [PARTS[2]!] };
    expect(renderAssignmentBounds(BOUNDS, { kind: "report", report, scoped: true })).toContain(
      "- assignments[0] part core-decide — (not in this report: run `phax architecture` with no path for its globs): claude-opus-5-5, medium–high",
    );
  });

  it("says a whole-repository report that lacks the part has no such part", () => {
    const report: ArchitectureReport = { body: "# A", parts: [PARTS[2]!] };
    expect(renderAssignmentBounds(BOUNDS, { kind: "report", report, scoped: false })).toContain(
      "- assignments[0] part core-decide — (unresolved: the report has no part core-decide): claude-opus-5-5, medium–high",
    );
  });

  it("folds a part name onto one line", () => {
    const report: ArchitectureReport = {
      body: "# A",
      parts: [{ ...PARTS[0]!, name: "core\n· decide" }],
    };
    expect(
      renderAssignmentBounds([BOUNDS[0]!], { kind: "report", report, scoped: false }),
    ).toContain("core · decide (");
  });
});
