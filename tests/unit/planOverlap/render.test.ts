import { describe, expect, it } from "vitest";
import { computePlanOverlap } from "../../../src/domain/planOverlap/compute.js";
import { renderPlanOverlap } from "../../../src/domain/planOverlap/render.js";
import type { PlanInput } from "../../../src/domain/planOverlap/types.js";

describe("renderPlanOverlap", () => {
  it("includes plan labels in the output", () => {
    const inputs: PlanInput[] = [
      { id: "a", label: "Plan Alpha", phases: [{ create: ["src/a.ts"], edit: [], optional: [] }] },
      { id: "b", label: "Plan Beta", phases: [{ create: ["src/b.ts"], edit: [], optional: [] }] },
    ];
    const result = computePlanOverlap(inputs);
    const rendered = renderPlanOverlap(result);
    expect(rendered).toContain("Plan Alpha");
    expect(rendered).toContain("Plan Beta");
  });

  it("shows 'clean' in matrix for disjoint plans", () => {
    const inputs: PlanInput[] = [
      { id: "a", label: "A", phases: [{ create: ["src/a.ts"], edit: [], optional: [] }] },
      { id: "b", label: "B", phases: [{ create: ["src/b.ts"], edit: [], optional: [] }] },
    ];
    const result = computePlanOverlap(inputs);
    const rendered = renderPlanOverlap(result);
    expect(rendered).toContain("A <-> B: clean");
  });

  it("shows severity and file in matrix for conflicting plans", () => {
    const inputs: PlanInput[] = [
      { id: "a", label: "A", phases: [{ create: [], edit: ["src/shared.ts"], optional: [] }] },
      { id: "b", label: "B", phases: [{ create: [], edit: ["src/shared.ts"], optional: [] }] },
    ];
    const result = computePlanOverlap(inputs);
    const rendered = renderPlanOverlap(result);
    expect(rendered).toContain("medium");
    expect(rendered).toContain("src/shared.ts");
  });

  it("includes caveat block in output", () => {
    const inputs: PlanInput[] = [
      { id: "a", label: "A", phases: [{ create: ["src/a.ts"], edit: [], optional: [] }] },
    ];
    const result = computePlanOverlap(inputs);
    const rendered = renderPlanOverlap(result);
    expect(rendered).toContain("Declared, not guaranteed");
    expect(rendered).toContain("File-level, not hunk-level");
    expect(rendered).toContain("Regenerated artifacts");
  });

  it("shows exhaustive-search skipped note when applicable", () => {
    const inputs: PlanInput[] = Array.from({ length: 17 }, (_, i) => ({
      id: `plan-${i}`,
      label: `Plan ${i}`,
      phases: [{ create: [`src/unique-${i}.ts`], edit: [], optional: [] }],
    }));
    const result = computePlanOverlap(inputs);
    const rendered = renderPlanOverlap(result);
    expect(rendered).toContain("search skipped");
  });

  it("produces stable output for fixed input", () => {
    const inputs: PlanInput[] = [
      { id: "a", label: "A", phases: [{ create: ["src/a.ts"], edit: ["src/b.ts"], optional: [] }] },
      { id: "b", label: "B", phases: [{ create: ["src/c.ts"], edit: ["src/b.ts"], optional: [] }] },
    ];
    const r1 = renderPlanOverlap(computePlanOverlap(inputs));
    const r2 = renderPlanOverlap(computePlanOverlap(inputs));
    expect(r1).toBe(r2);
  });

  it("includes wave schedule lines", () => {
    const inputs: PlanInput[] = [
      { id: "a", label: "A", phases: [{ create: [], edit: ["src/shared.ts"], optional: [] }] },
      { id: "b", label: "B", phases: [{ create: [], edit: ["src/shared.ts"], optional: [] }] },
    ];
    const result = computePlanOverlap(inputs);
    const rendered = renderPlanOverlap(result);
    expect(rendered).toContain("Wave 1:");
    expect(rendered).toContain("Wave 2:");
  });
});
