import { describe, expect, it } from "vitest";
import {
  buildOverview,
  type ArchitectureOutcome,
  type OverviewCriteriaInput,
  type PlanOverview,
} from "../../src/domain/plan/overview.js";
import { renderOverview } from "../../src/domain/plan/overviewRender.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { TestLine } from "../../src/schemas/testLine.js";

const line = (
  guarantee: string,
  loop: TestLine["loop"],
  criterion: string | null = null,
): TestLine => ({
  guarantee,
  size: "small",
  technique: "example",
  oracle: "the findings",
  loop,
  criterion,
});

type Phase = Pick<
  PhaxPlanPhase,
  | "id"
  | "title"
  | "model"
  | "effort"
  | "mode"
  | "oracle"
  | "plannedFilesToCreate"
  | "plannedFilesToEdit"
  | "testLines"
>;

const phase = (id: string, over: Partial<Phase> = {}): Phase => ({
  id,
  title: `Title of ${id}`,
  model: "claude-sonnet-5-5",
  effort: "medium",
  mode: "headless",
  oracle: null,
  plannedFilesToCreate: [],
  plannedFilesToEdit: [],
  testLines: [],
  ...over,
});

const PHASES: readonly Phase[] = [
  phase("phase-01", {
    title: "Oracles",
    oracle: { dischargedBy: "phase-02", files: ["tests/a.test.ts"] },
    plannedFilesToCreate: ["tests/a.test.ts"],
    testLines: [line("the rule holds", "oracle", "ac-a")],
  }),
  phase("phase-02", {
    title: "Discharge",
    plannedFilesToCreate: ["src/domain/x.ts"],
    plannedFilesToEdit: ["tests/a.test.ts", "src/domain/x.ts"],
    testLines: [line("it is read", "in-phase", "ac-a"), line("it is shown", "in-phase", "ac-b")],
  }),
  phase("phase-03", {
    title: "Review screen",
    model: "claude-opus-5-5",
    effort: "high",
    mode: "interactive",
    testLines: [],
  }),
];

const NO_PARTS: ArchitectureOutcome = { kind: "none" };
const PARTS: ArchitectureOutcome = {
  kind: "parts",
  parts: [
    { id: "domain", globs: ["src/domain/**"] },
    { id: "app", globs: ["src/app/**"] },
    { id: "tests", globs: ["tests/**"] },
  ],
};
const NO_SOURCE: OverviewCriteriaInput = { kind: "no-source-spec" };

function overview(opts: {
  phases?: readonly Phase[];
  architecture?: ArchitectureOutcome;
  criteria?: OverviewCriteriaInput;
  sourceSpec?: PlanOverview["sourceSpec"];
  frontmatter?: PlanOverview["frontmatter"];
}): PlanOverview {
  return buildOverview({
    plan: "docs/plans/2610240900-demo-plan.md",
    name: "demo-plan",
    title: "Demo",
    frontmatter: opts.frontmatter ?? { kind: "decoded", status: "Draft" },
    sourceSpec: opts.sourceSpec === undefined ? null : opts.sourceSpec,
    phases: opts.phases ?? PHASES,
    architecture: opts.architecture ?? NO_PARTS,
    criteria: opts.criteria ?? NO_SOURCE,
  });
}

describe("the overview's layout", () => {
  it("shows an oracle phase, its discharging phase and an interactive phase in plan order", () => {
    const text = renderOverview(overview({}));
    expect(text).toBe(
      [
        "demo-plan — Demo  (Draft · no source spec)",
        "architecture: no provider configured — planned files shown",
        "",
        "phase-01 — Oracles  claude-sonnet-5-5 · medium · headless",
        "  oracle role  oracle phase, discharged by phase-02",
        "  files        tests/a.test.ts",
        "  - the rule holds — small · example · the findings · oracle · ac-a",
        "",
        "phase-02 — Discharge  claude-sonnet-5-5 · medium · headless",
        "  oracle role  discharges phase-01",
        "  files        src/domain/x.ts, tests/a.test.ts",
        "  - it is read — small · example · the findings · in-phase · ac-a",
        "  - it is shown — small · example · the findings · in-phase · ac-b",
        "",
        "phase-03 — Review screen  claude-opus-5-5 · high · interactive",
        "  oracle role  none",
        "  (no planned files)",
        "  (no test lines)",
        "",
        "no source spec: no criterion coverage",
      ].join("\n"),
    );
  });

  it("names a loose plan.md's missing frontmatter and a source spec", () => {
    const text = renderOverview(
      overview({
        frontmatter: { kind: "none" },
        sourceSpec: { path: "docs/specs/x.md", slug: "invoice-export" },
      }),
    );
    expect(text.split("\n")[0]).toBe(
      "demo-plan — Demo  (no frontmatter · source spec invoice-export)",
    );
  });

  it("names a loose plan.md's frontmatter that does not decode, and a source spec it did not read", () => {
    const text = renderOverview(
      overview({ frontmatter: { kind: "undecodable", problem: "status: is missing" } }),
    );
    expect(text.split("\n")[0]).toBe(
      "demo-plan — Demo  (frontmatter does not decode: status: is missing · source spec not read)",
    );
  });

  it("says the provider failed on the architecture line", () => {
    const text = renderOverview(overview({ architecture: { kind: "failed", message: "boom" } }));
    expect(text.split("\n")[1]).toBe("architecture: provider failed — planned files shown");
  });
});

describe("the placement", () => {
  it("puts each file under every part that holds it and the rest under (no part)", () => {
    const planned = phase("phase-01", {
      plannedFilesToCreate: ["src/domain/x.ts", "scripts/y.sh"],
      plannedFilesToEdit: ["src/app/z.ts", "src/domain/x.ts"],
    });
    const built = overview({ phases: [planned], architecture: PARTS });
    expect(built.phases[0]!.placement).toEqual([
      { part: "domain", files: ["src/domain/x.ts"] },
      { part: "app", files: ["src/app/z.ts"] },
      { part: null, files: ["scripts/y.sh"] },
    ]);
    const text = renderOverview(built);
    expect(text).toContain("architecture: parts from the configured provider");
    expect(text).toContain("  domain       src/domain/x.ts");
    expect(text).toContain("  app          src/app/z.ts");
    expect(text).toContain("  (no part)    scripts/y.sh");
  });

  it("lists a file under two parts that both match it, in report order", () => {
    const architecture: ArchitectureOutcome = {
      kind: "parts",
      parts: [
        { id: "wide", globs: ["src/**"] },
        { id: "narrow", globs: ["src/domain/*.ts"] },
      ],
    };
    const built = overview({
      phases: [phase("phase-01", { plannedFilesToCreate: ["src/domain/x.ts"] })],
      architecture,
    });
    expect(built.phases[0]!.placement).toEqual([
      { part: "wide", files: ["src/domain/x.ts"] },
      { part: "narrow", files: ["src/domain/x.ts"] },
      { part: null, files: [] },
    ]);
    expect(renderOverview(built)).not.toContain("(no part)");
  });

  it("lists only the parts that hold a file, and always ends with the null entry", () => {
    const built = overview({
      phases: [phase("phase-01", { plannedFilesToCreate: ["docs/x.md"] })],
      architecture: PARTS,
    });
    expect(built.phases[0]!.placement).toEqual([{ part: null, files: ["docs/x.md"] }]);
    expect(renderOverview(built)).toContain("  (no part)    docs/x.md");
  });

  it("without parts, holds every file in the one null entry", () => {
    for (const architecture of [NO_PARTS, { kind: "failed", message: "x" } as const]) {
      const built = overview({ architecture });
      expect(built.phases[1]!.placement).toEqual([
        { part: null, files: ["src/domain/x.ts", "tests/a.test.ts"] },
      ]);
      expect(built.phases[2]!.placement).toEqual([{ part: null, files: [] }]);
    }
  });
});

describe("the coverage block", () => {
  const CRITERIA: OverviewCriteriaInput = {
    kind: "criteria",
    spec: "docs/specs/2610231100-invoice-export.md",
    slug: "invoice-export",
    ids: ["ac-a", "ac-b", "ac-c"],
  };

  it("ends with each criterion against the phases and loops that name it", () => {
    const built = overview({ criteria: CRITERIA });
    expect(built.coverage).toEqual({
      kind: "criteria",
      spec: "docs/specs/2610231100-invoice-export.md",
      slug: "invoice-export",
      criteria: [
        {
          id: "ac-a",
          lines: [
            { phase: "phase-01", loop: "oracle" },
            { phase: "phase-02", loop: "in-phase" },
          ],
        },
        { id: "ac-b", lines: [{ phase: "phase-02", loop: "in-phase" }] },
        { id: "ac-c", lines: [] },
      ],
      uncovered: ["ac-c"],
    });
    expect(renderOverview(built).split("\n\n").at(-1)).toBe(
      [
        "acceptance criteria of invoice-export",
        "  ac-a       phase-01 oracle, phase-02 in-phase",
        "  ac-b       phase-02 in-phase",
        "  ac-c       (no test line)",
        "  uncovered  ac-c",
      ].join("\n"),
    );
  });

  // The JSON keeps one entry per line; the text counts a repeated (phase, loop).
  it("counts the lines of one phase and loop naming a criterion, keeping one JSON entry per line", () => {
    const phases = [
      phase("phase-01", { testLines: [line("it is read", "oracle", "ac-a")] }),
      phase("phase-02", {
        testLines: [
          line("it is read", "in-phase", "ac-a"),
          line("it is shown", "in-phase", "ac-a"),
          line("it is kept", "oracle", "ac-a"),
          line("it is sorted", "in-phase", "ac-a"),
        ],
      }),
    ];
    const built = overview({ phases, criteria: { ...CRITERIA, ids: ["ac-a"] } });

    expect(built.coverage).toMatchObject({
      criteria: [
        {
          id: "ac-a",
          lines: [
            { phase: "phase-01", loop: "oracle" },
            { phase: "phase-02", loop: "in-phase" },
            { phase: "phase-02", loop: "in-phase" },
            { phase: "phase-02", loop: "oracle" },
            { phase: "phase-02", loop: "in-phase" },
          ],
        },
      ],
    });
    expect(renderOverview(built).split("\n").at(-2)).toBe(
      "  ac-a       phase-01 oracle, phase-02 in-phase ×3, phase-02 oracle",
    );
  });

  it("reports (none) when every criterion is named", () => {
    const built = overview({ criteria: { ...CRITERIA, ids: ["ac-a", "ac-b"] } });
    expect(renderOverview(built).split("\n").at(-1)).toBe("  uncovered  (none)");
  });

  it("ignores an id the spec does not have", () => {
    const built = overview({ criteria: { ...CRITERIA, ids: ["ac-b"] } });
    expect(built.coverage).toMatchObject({
      criteria: [{ id: "ac-b", lines: [{ phase: "phase-02", loop: "in-phase" }] }],
      uncovered: [],
    });
  });

  it("carries the one shared line for a spec whose ids are not known", () => {
    const criteria: OverviewCriteriaInput = {
      kind: "no-criterion-ids",
      spec: "docs/specs/2610231100-invoice-export.md",
      reason: "no-sidecar",
      message: "source spec docs/specs/2610231100-invoice-export.md has no JSON sidecar",
    };
    const built = overview({ criteria });
    expect(built.coverage).toEqual(criteria);
    expect(renderOverview(built).split("\n").at(-1)).toBe(criteria.message);
  });

  it("carries the one shared line for a frontmatter that does not decode", () => {
    const message =
      "the plan's frontmatter does not decode (status: is missing): no source spec is read, no criterion id is checked";
    const built = overview({
      frontmatter: { kind: "undecodable", problem: "status: is missing" },
      criteria: { kind: "frontmatter-undecodable", problem: "status: is missing", message },
    });
    expect(built.coverage).toEqual({ kind: "frontmatter-undecodable", message });
    expect(renderOverview(built).split("\n").at(-1)).toBe(message);
  });

  it("says there is no criterion coverage for a plan without a source spec", () => {
    const built = overview({});
    expect(built.coverage).toEqual({ kind: "no-source-spec" });
    expect(renderOverview(built).split("\n").at(-1)).toBe("no source spec: no criterion coverage");
  });
});

describe("the JSON value", () => {
  it("carries the same content as the rendering, with explicit kinds", () => {
    const built = overview({
      architecture: PARTS,
      sourceSpec: { path: "docs/specs/x.md", slug: "invoice-export" },
      criteria: {
        kind: "criteria",
        spec: "docs/specs/x.md",
        slug: "invoice-export",
        ids: ["ac-a", "ac-c"],
      },
    });
    const json = JSON.parse(JSON.stringify(built, null, 2)) as PlanOverview;
    expect(json).toEqual(built);
    expect(json.architecture).toEqual({ kind: "parts" });
    expect(json.phases.map((p) => p.oracleRole)).toEqual([
      { kind: "oracle", dischargedBy: "phase-02" },
      { kind: "discharging", oraclePhase: "phase-01" },
      { kind: "none" },
    ]);
    // Every file the rendering shows is in the document, and the reverse.
    const text = renderOverview(built);
    for (const p of json.phases) {
      for (const { files } of p.placement) {
        for (const file of files) expect(text).toContain(file);
      }
      for (const testLine of p.testLines) expect(text).toContain(testLine.guarantee);
      expect(text).toContain(`${p.id} — ${p.title}  ${p.model} · ${p.effort} · ${p.mode}`);
    }
    expect(json.coverage.kind).toBe("criteria");
    expect(text).toContain("uncovered  ac-c");
  });

  it("carries a failed architecture with its message", () => {
    const built = overview({ architecture: { kind: "failed", message: "exit 1" } });
    expect(built.architecture).toEqual({ kind: "failed", message: "exit 1" });
  });
});
