import { describe, expect, it } from "vitest";
import {
  buildFootprint,
  buildLandedFootprint,
  computeReadjustmentImpact,
} from "../../../src/domain/planOverlap/compute.js";
import type { LandedInput, PlanInput } from "../../../src/domain/planOverlap/types.js";

function makePlanInput(id: string, creates: string[], edits: string[]): PlanInput {
  return {
    id,
    label: `Plan ${id}`,
    phases: [{ create: creates, edit: edits, optional: [] }],
  };
}

function makeLanded(added: string[], modified: string[], deletedOrRenamed: string[]): LandedInput {
  return { id: "run-path", label: "landed-run", added, modified, deletedOrRenamed };
}

describe("buildLandedFootprint", () => {
  it("maps added → create, modified → edit, deletedOrRenamed → edit", () => {
    const fp = buildLandedFootprint(makeLanded(["src/new.ts"], ["src/mod.ts"], ["src/old.ts"]));
    expect(fp.create.has("src/new.ts")).toBe(true);
    expect(fp.edit.has("src/mod.ts")).toBe(true);
    expect(fp.edit.has("src/old.ts")).toBe(true);
    expect(fp.all.has("src/new.ts")).toBe(true);
    expect(fp.all.has("src/mod.ts")).toBe(true);
    expect(fp.all.has("src/old.ts")).toBe(true);
    expect(fp.optional.size).toBe(0);
  });

  it("empty inputs produce empty footprint", () => {
    const fp = buildLandedFootprint(makeLanded([], [], []));
    expect(fp.all.size).toBe(0);
  });
});

describe("computeReadjustmentImpact", () => {
  it("a plan sharing a .ts file with the landed run is impacted with medium severity", () => {
    const landed = buildLandedFootprint(makeLanded([], ["src/shared.ts"], []));
    const planA = buildFootprint(makePlanInput("plan-a", [], ["src/shared.ts"]));
    const planB = buildFootprint(makePlanInput("plan-b", [], ["src/other.ts"]));

    const result = computeReadjustmentImpact(landed, [planA, planB]);

    expect(result.impacted).toHaveLength(1);
    expect(result.impacted[0]?.id).toBe("plan-a");
    expect(result.impacted[0]?.severity).toBe("medium");
    expect(result.unaffected).toContain("plan-b");
  });

  it("a landed added path that another plan also creates → hard severity", () => {
    const landed = buildLandedFootprint(makeLanded(["src/foo.ts"], [], []));
    const plan = buildFootprint(makePlanInput("plan-x", ["src/foo.ts"], []));

    const result = computeReadjustmentImpact(landed, [plan]);

    expect(result.impacted).toHaveLength(1);
    expect(result.impacted[0]?.severity).toBe("hard");
  });

  it("a landed phax.usage.kdl change is hard for any plan that regenerates it", () => {
    const landed = buildLandedFootprint(makeLanded([], ["phax.usage.kdl"], []));
    const plan = buildFootprint(makePlanInput("plan-y", [], ["phax.usage.kdl"]));

    const result = computeReadjustmentImpact(landed, [plan]);

    expect(result.impacted).toHaveLength(1);
    expect(result.impacted[0]?.severity).toBe("hard");
    expect(result.impacted[0]?.shared[0]?.reason).toMatch(/regenerated/i);
  });

  it("impacted list is ordered by descending severity", () => {
    const landed = buildLandedFootprint(
      makeLanded([], ["src/a.ts", "README.md", "phax.usage.kdl"], []),
    );
    const planA = buildFootprint(makePlanInput("plan-a", [], ["README.md"])); // soft
    const planB = buildFootprint(makePlanInput("plan-b", [], ["src/a.ts"])); // medium
    const planC = buildFootprint(makePlanInput("plan-c", [], ["phax.usage.kdl"])); // hard

    const result = computeReadjustmentImpact(landed, [planA, planB, planC]);

    expect(result.impacted.map((p) => p.severity)).toEqual(["hard", "medium", "soft"]);
  });

  it("plans with no shared files are unaffected", () => {
    const landed = buildLandedFootprint(makeLanded(["src/a.ts"], [], []));
    const plan = buildFootprint(makePlanInput("plan-z", [], ["src/b.ts"]));

    const result = computeReadjustmentImpact(landed, [plan]);

    expect(result.impacted).toHaveLength(0);
    expect(result.unaffected).toContain("plan-z");
  });

  it("landed deleted/renamed path is treated as an edit for collision", () => {
    const landed = buildLandedFootprint(makeLanded([], [], ["src/deleted.ts"]));
    const plan = buildFootprint(makePlanInput("plan-d", [], ["src/deleted.ts"]));

    const result = computeReadjustmentImpact(landed, [plan]);

    expect(result.impacted).toHaveLength(1);
    // both edit → medium (not .md)
    expect(result.impacted[0]?.severity).toBe("medium");
  });
});
