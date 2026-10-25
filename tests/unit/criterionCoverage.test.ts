import { describe, it, expect } from "vitest";
import { criterionCoverage, type CoveragePhase } from "../../src/domain/plan/criterionCoverage.js";

const phase = (
  id: string,
  ...lines: Array<[item: number, loop: "oracle" | "in-phase", criterion: string | null]>
): CoveragePhase => ({
  id,
  lines: lines.map(([item, loop, criterion]) => ({ item, loop, criterion })),
});

describe("criterionCoverage", () => {
  it.each([
    {
      name: "no phase, no criterion",
      phases: [],
      ids: [],
      expected: { covered: [], uncovered: [], unknown: [] },
    },
    {
      name: "no line names a criterion",
      phases: [phase("phase-01", [1, "in-phase", null])],
      ids: ["ac-a", "ac-b"],
      expected: {
        covered: [
          { id: "ac-a", namedBy: [] },
          { id: "ac-b", namedBy: [] },
        ],
        uncovered: ["ac-a", "ac-b"],
        unknown: [],
      },
    },
    {
      name: "each criterion lists its lines in plan and line order, ids in spec order",
      phases: [
        phase("phase-01", [1, "oracle", "ac-b"], [2, "in-phase", "ac-a"]),
        phase("phase-02", [1, "in-phase", "ac-b"]),
      ],
      ids: ["ac-a", "ac-b", "ac-c"],
      expected: {
        covered: [
          { id: "ac-a", namedBy: [{ phase: "phase-01", loop: "in-phase" }] },
          {
            id: "ac-b",
            namedBy: [
              { phase: "phase-01", loop: "oracle" },
              { phase: "phase-02", loop: "in-phase" },
            ],
          },
          { id: "ac-c", namedBy: [] },
        ],
        uncovered: ["ac-c"],
        unknown: [],
      },
    },
    {
      name: "an unknown reference keeps its source item number",
      phases: [phase("phase-01", [2, "in-phase", "ac-z"], [4, "in-phase", "ac-a"])],
      ids: ["ac-a"],
      expected: {
        covered: [{ id: "ac-a", namedBy: [{ phase: "phase-01", loop: "in-phase" }] }],
        uncovered: [],
        unknown: [{ phase: "phase-01", line: 2, id: "ac-z" }],
      },
    },
  ])("$name", ({ phases, ids, expected }) => {
    expect(criterionCoverage(phases, ids)).toEqual(expected);
  });
});
