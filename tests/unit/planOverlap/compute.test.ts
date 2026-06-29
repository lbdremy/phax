import { describe, expect, it } from "vitest";
import {
  buildFootprint,
  classifyShared,
  computePlanOverlap,
} from "../../../src/domain/planOverlap/compute.js";
import type { PlanInput } from "../../../src/domain/planOverlap/types.js";

const planA: PlanInput = {
  id: "plan-a",
  label: "Plan A",
  phases: [{ create: ["src/foo.ts"], edit: ["src/bar.ts"], optional: [] }],
};

const planB: PlanInput = {
  id: "plan-b",
  label: "Plan B",
  phases: [{ create: ["src/baz.ts"], edit: ["src/qux.ts"], optional: [] }],
};

describe("buildFootprint", () => {
  it("unions all phase file sets", () => {
    const input: PlanInput = {
      id: "x",
      label: "X",
      phases: [
        { create: ["a.ts"], edit: ["b.ts"], optional: ["c.ts"] },
        { create: ["d.ts"], edit: ["e.ts"], optional: [] },
      ],
    };
    const fp = buildFootprint(input);
    expect([...fp.create]).toEqual(["a.ts", "d.ts"]);
    expect([...fp.edit]).toEqual(["b.ts", "e.ts"]);
    expect([...fp.optional]).toEqual(["c.ts"]);
    expect(fp.all.size).toBe(5);
  });

  it("a path in both create and edit across phases appears in both sets", () => {
    const input: PlanInput = {
      id: "x",
      label: "X",
      phases: [
        { create: ["a.ts"], edit: [], optional: [] },
        { create: [], edit: ["a.ts"], optional: [] },
      ],
    };
    const fp = buildFootprint(input);
    expect(fp.create.has("a.ts")).toBe(true);
    expect(fp.edit.has("a.ts")).toBe(true);
    expect(fp.all.size).toBe(1);
  });
});

describe("classifyShared", () => {
  it("regenerated artifact → hard", () => {
    const a = buildFootprint({
      id: "a",
      label: "A",
      phases: [{ create: [], edit: ["phax.usage.kdl"], optional: [] }],
    });
    const b = buildFootprint({
      id: "b",
      label: "B",
      phases: [{ create: [], edit: ["phax.usage.kdl"], optional: [] }],
    });
    const result = classifyShared("phax.usage.kdl", a, b);
    expect(result.severity).toBe("hard");
    expect(result.reason).toContain("regenerated artifact");
  });

  it("both create → hard", () => {
    const a = buildFootprint({
      id: "a",
      label: "A",
      phases: [{ create: ["src/x.ts"], edit: [], optional: [] }],
    });
    const b = buildFootprint({
      id: "b",
      label: "B",
      phases: [{ create: ["src/x.ts"], edit: [], optional: [] }],
    });
    const result = classifyShared("src/x.ts", a, b);
    expect(result.severity).toBe("hard");
    expect(result.reason).toContain("both plans create");
  });

  it("create vs edit → hard", () => {
    const a = buildFootprint({
      id: "a",
      label: "A",
      phases: [{ create: ["src/x.ts"], edit: [], optional: [] }],
    });
    const b = buildFootprint({
      id: "b",
      label: "B",
      phases: [{ create: [], edit: ["src/x.ts"], optional: [] }],
    });
    const result = classifyShared("src/x.ts", a, b);
    expect(result.severity).toBe("hard");
  });

  it("both edit non-.md → medium", () => {
    const a = buildFootprint({
      id: "a",
      label: "A",
      phases: [{ create: [], edit: ["src/x.ts"], optional: [] }],
    });
    const b = buildFootprint({
      id: "b",
      label: "B",
      phases: [{ create: [], edit: ["src/x.ts"], optional: [] }],
    });
    const result = classifyShared("src/x.ts", a, b);
    expect(result.severity).toBe("medium");
  });

  it("both edit .md → soft", () => {
    const a = buildFootprint({
      id: "a",
      label: "A",
      phases: [{ create: [], edit: ["README.md"], optional: [] }],
    });
    const b = buildFootprint({
      id: "b",
      label: "B",
      phases: [{ create: [], edit: ["README.md"], optional: [] }],
    });
    const result = classifyShared("README.md", a, b);
    expect(result.severity).toBe("soft");
  });

  it("optional only → soft", () => {
    const a = buildFootprint({
      id: "a",
      label: "A",
      phases: [{ create: [], edit: [], optional: ["src/x.ts"] }],
    });
    const b = buildFootprint({
      id: "b",
      label: "B",
      phases: [{ create: [], edit: [], optional: ["src/x.ts"] }],
    });
    const result = classifyShared("src/x.ts", a, b);
    expect(result.severity).toBe("soft");
  });
});

describe("computePlanOverlap", () => {
  it("two disjoint plans → no edges, both in cleanPairs, one wave", () => {
    const result = computePlanOverlap([planA, planB]);
    expect(result.edges).toHaveLength(0);
    expect(result.cleanPairs).toHaveLength(1);
    expect(result.cleanPairs[0]).toEqual(["plan-a", "plan-b"]);
    expect(result.largestParallelSafeSet).toContain("plan-a");
    expect(result.largestParallelSafeSet).toContain("plan-b");
    expect(result.waves).toHaveLength(1);
    expect(result.waves[0]).toContain("plan-a");
    expect(result.waves[0]).toContain("plan-b");
    expect(result.exhaustiveSearchSkipped).toBe(false);
  });

  it("two plans sharing a .ts file both edit → medium edge, separate waves", () => {
    const a: PlanInput = {
      id: "a",
      label: "A",
      phases: [{ create: [], edit: ["src/shared.ts"], optional: [] }],
    };
    const b: PlanInput = {
      id: "b",
      label: "B",
      phases: [{ create: [], edit: ["src/shared.ts"], optional: [] }],
    };
    const result = computePlanOverlap([a, b]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.severity).toBe("medium");
    expect(result.cleanPairs).toHaveLength(0);
    expect(result.waves).toHaveLength(2);
  });

  it("two plans both listing phax.usage.kdl → hard edge", () => {
    const a: PlanInput = {
      id: "a",
      label: "A",
      phases: [{ create: [], edit: ["phax.usage.kdl"], optional: [] }],
    };
    const b: PlanInput = {
      id: "b",
      label: "B",
      phases: [{ create: [], edit: ["phax.usage.kdl"], optional: [] }],
    };
    const result = computePlanOverlap([a, b]);
    expect(result.edges[0]!.severity).toBe("hard");
    expect(result.edges[0]!.shared[0]!.reason).toContain("regenerated artifact");
  });

  it("create-vs-create on same path → hard", () => {
    const a: PlanInput = {
      id: "a",
      label: "A",
      phases: [{ create: ["src/new.ts"], edit: [], optional: [] }],
    };
    const b: PlanInput = {
      id: "b",
      label: "B",
      phases: [{ create: ["src/new.ts"], edit: [], optional: [] }],
    };
    const result = computePlanOverlap([a, b]);
    expect(result.edges[0]!.severity).toBe("hard");
  });

  it("create-vs-edit on same path → hard", () => {
    const a: PlanInput = {
      id: "a",
      label: "A",
      phases: [{ create: ["src/new.ts"], edit: [], optional: [] }],
    };
    const b: PlanInput = {
      id: "b",
      label: "B",
      phases: [{ create: [], edit: ["src/new.ts"], optional: [] }],
    };
    const result = computePlanOverlap([a, b]);
    expect(result.edges[0]!.severity).toBe("hard");
  });

  it("shared README.md (both edit) → soft", () => {
    const a: PlanInput = {
      id: "a",
      label: "A",
      phases: [{ create: [], edit: ["README.md"], optional: [] }],
    };
    const b: PlanInput = {
      id: "b",
      label: "B",
      phases: [{ create: [], edit: ["README.md"], optional: [] }],
    };
    const result = computePlanOverlap([a, b]);
    expect(result.edges[0]!.severity).toBe("soft");
  });

  it("four-plan set: clean pairs and largest set size 2", () => {
    // A and C conflict, B and D conflict, otherwise disjoint
    const a: PlanInput = {
      id: "a",
      label: "A",
      phases: [{ create: [], edit: ["src/shared-ac.ts"], optional: [] }],
    };
    const b: PlanInput = {
      id: "b",
      label: "B",
      phases: [{ create: [], edit: ["src/shared-bd.ts"], optional: [] }],
    };
    const c: PlanInput = {
      id: "c",
      label: "C",
      phases: [{ create: [], edit: ["src/shared-ac.ts"], optional: [] }],
    };
    const d: PlanInput = {
      id: "d",
      label: "D",
      phases: [{ create: [], edit: ["src/shared-bd.ts"], optional: [] }],
    };
    const result = computePlanOverlap([a, b, c, d]);

    // Edges: a<->c and b<->d
    expect(result.edges).toHaveLength(2);

    // Clean pairs: a<->b, a<->d, b<->c, c<->d
    expect(result.cleanPairs).toHaveLength(4);

    // Largest parallel-safe set: {a,b} or {a,d} or {b,c} or {c,d} — size 2
    expect(result.largestParallelSafeSet).toHaveLength(2);
  });

  it("exhaustiveSearchSkipped when more than 16 inputs", () => {
    const inputs: PlanInput[] = Array.from({ length: 17 }, (_, i) => ({
      id: `plan-${i}`,
      label: `Plan ${i}`,
      phases: [{ create: [`src/unique-${i}.ts`], edit: [], optional: [] }],
    }));
    const result = computePlanOverlap(inputs);
    expect(result.exhaustiveSearchSkipped).toBe(true);
    expect(result.largestParallelSafeSet).toHaveLength(0);
    // waves still cover all plans
    const waveCoverage = result.waves.flat();
    expect(waveCoverage).toHaveLength(17);
  });

  it("output is stable (same input → same output)", () => {
    const inputs: PlanInput[] = [
      { id: "x", label: "X", phases: [{ create: ["a.ts"], edit: [], optional: [] }] },
      { id: "y", label: "Y", phases: [{ create: [], edit: ["a.ts"], optional: [] }] },
    ];
    const r1 = computePlanOverlap(inputs);
    const r2 = computePlanOverlap(inputs);
    expect(r1.edges[0]!.severity).toBe(r2.edges[0]!.severity);
    expect(r1.cleanPairs).toEqual(r2.cleanPairs);
  });
});
