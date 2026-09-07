import { describe, expect, it } from "vitest";
import { makeScopesRequest, projectPhases } from "../../src/domain/plan/projection.js";

const phases = [
  {
    id: "phase-01",
    plannedFilesToCreate: ["src/core/billing/port.ts"],
    plannedFilesToEdit: [],
  },
  {
    id: "phase-02",
    plannedFilesToCreate: [],
    plannedFilesToEdit: ["src/core/billing/invoice.ts"],
  },
  {
    id: "phase-03",
    plannedFilesToCreate: ["src/adapters/billing/stripe.ts"],
    plannedFilesToEdit: [],
  },
];

describe("projectPhases", () => {
  it("preserves phase order", () => {
    const projected = projectPhases(phases);
    expect(projected.map((phase) => phase.id)).toEqual(["phase-01", "phase-02", "phase-03"]);
  });

  it("puts created files before edited files, order preserved", () => {
    const projected = projectPhases([
      {
        id: "phase-01",
        plannedFilesToCreate: ["a.ts", "b.ts"],
        plannedFilesToEdit: ["c.ts", "d.ts"],
      },
    ]);
    expect(projected[0]?.files).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
  });

  it("dedupes a file listed in both create and edit, keeping first occurrence order", () => {
    const projected = projectPhases([
      {
        id: "phase-01",
        plannedFilesToCreate: ["a.ts"],
        plannedFilesToEdit: ["a.ts", "b.ts"],
      },
    ]);
    expect(projected[0]?.files).toEqual(["a.ts", "b.ts"]);
  });

  it("does not read optionalFilesToEdit", () => {
    const projected = projectPhases([
      {
        id: "phase-01",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: ["src/index.ts"],
      } as unknown as (typeof phases)[number],
    ]);
    expect(projected[0]?.files).toEqual([]);
  });
});

describe("makeScopesRequest", () => {
  it("shapes exactly { phase, phases: [{ id, files }] }", () => {
    const request = makeScopesRequest(phases, "phase-02");

    expect(Object.keys(request).toSorted()).toEqual(["phase", "phases"]);
    for (const phase of request.phases) {
      expect(Object.keys(phase).toSorted()).toEqual(["files", "id"]);
    }
  });

  it("sets phase to the gated phase id", () => {
    const request = makeScopesRequest(phases, "phase-02");
    expect(request.phase).toBe("phase-02");
  });

  it("carries every phase's projection regardless of the gated phase", () => {
    const request = makeScopesRequest(phases, "phase-02");
    expect(request.phases).toEqual([
      { id: "phase-01", files: ["src/core/billing/port.ts"] },
      { id: "phase-02", files: ["src/core/billing/invoice.ts"] },
      { id: "phase-03", files: ["src/adapters/billing/stripe.ts"] },
    ]);
  });
});
