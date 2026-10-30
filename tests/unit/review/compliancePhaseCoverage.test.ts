import { describe, expect, it } from "vitest";
import { phaseCoverageRefusal } from "../../../src/domain/review/compliancePhaseCoverage.js";

describe("phaseCoverageRefusal", () => {
  it.fails.each([
    {
      name: "the same phases in the same order",
      answered: ["phase-01", "phase-02", "phase-03"],
      run: ["phase-01", "phase-02", "phase-03"],
      expected: null,
    },
    {
      name: "the same phases in another order",
      answered: ["phase-03", "phase-01", "phase-02"],
      run: ["phase-01", "phase-02", "phase-03"],
      expected: null,
    },
    {
      name: "an unknown phase and a missing one",
      answered: ["phase-01", "phase-02", "phase-04"],
      run: ["phase-01", "phase-02", "phase-03"],
      expected:
        'perPhase: phase "phase-04" is not a phase of this run; perPhase: phase "phase-03" is missing',
    },
    {
      name: "a repeated phase",
      answered: ["phase-01", "phase-01", "phase-02"],
      run: ["phase-01", "phase-02"],
      expected: 'perPhase: phase "phase-01" is named more than once',
    },
    {
      name: "a missing phase",
      answered: ["phase-01", "phase-03"],
      run: ["phase-01", "phase-02", "phase-03"],
      expected: 'perPhase: phase "phase-02" is missing',
    },
    {
      name: "no answered phase",
      answered: [],
      run: ["phase-01"],
      expected: 'perPhase: phase "phase-01" is missing',
    },
  ])("$name", ({ answered, run, expected }) => {
    expect(phaseCoverageRefusal(answered, run)).toBe(expected);
  });
});
