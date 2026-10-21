import { describe, expect, it } from "vitest";
import {
  dischargedOracleFiles,
  oraclePairs,
  oracleRoleOf,
  recordOracleRole,
  renderOraclePairsSection,
} from "../../src/domain/plan/oraclePairs.js";

// A five-phase plan with one pair: phase-02 authors tests/prune.test.ts and
// phase-04 discharges it.
const phases = [
  { id: "phase-01", oracle: null },
  { id: "phase-02", oracle: { dischargedBy: "phase-04", files: ["tests/prune.test.ts"] } },
  { id: "phase-03", oracle: null },
  { id: "phase-04", oracle: null },
  { id: "phase-05", oracle: null },
];

const pair = {
  oraclePhase: "phase-02",
  dischargingPhase: "phase-04",
  files: ["tests/prune.test.ts"],
};

describe("oraclePairs", () => {
  it("lists a pair per non-null oracle, in plan order", () => {
    const two = [
      { id: "phase-01", oracle: { dischargedBy: "phase-03", files: ["tests/refunds.test.ts"] } },
      { id: "phase-02", oracle: null },
      { id: "phase-03", oracle: null },
      { id: "phase-04", oracle: { dischargedBy: "phase-05", files: ["tests/prune.test.ts"] } },
      { id: "phase-05", oracle: null },
    ];
    expect(oraclePairs(two).map((p) => [p.oraclePhase, p.dischargingPhase])).toEqual([
      ["phase-01", "phase-03"],
      ["phase-04", "phase-05"],
    ]);
  });

  it("is empty for a plan without an oracle", () => {
    expect(oraclePairs(phases.map(({ id }) => ({ id, oracle: null })))).toEqual([]);
  });
});

describe("oracleRoleOf", () => {
  it("names the oracle phase and the discharging phase, and no other", () => {
    expect(oracleRoleOf(phases, "phase-02")).toEqual({ role: "oracle", pair });
    expect(oracleRoleOf(phases, "phase-04")).toEqual({ role: "discharging", pair });
    for (const id of ["phase-01", "phase-03", "phase-05", "phase-09"]) {
      expect(oracleRoleOf(phases, id)).toBeNull();
    }
  });
});

describe("recordOracleRole", () => {
  it("maps a role to the manifest's value", () => {
    expect(recordOracleRole(oracleRoleOf(phases, "phase-02"))).toEqual({
      role: "oracle",
      dischargedBy: "phase-04",
    });
    expect(recordOracleRole(oracleRoleOf(phases, "phase-04"))).toEqual({
      role: "discharging",
      oraclePhase: "phase-02",
    });
    expect(recordOracleRole(null)).toBeNull();
  });
});

describe("renderOraclePairsSection", () => {
  it("renders one table row per pair", () => {
    expect(
      renderOraclePairsSection([
        {
          oraclePhase: "phase-02",
          dischargingPhase: "phase-03",
          authored: "pass",
          discharged: "pass",
        },
        {
          oraclePhase: "phase-04",
          dischargingPhase: "phase-05",
          authored: "fail",
          discharged: "not run",
        },
      ]),
    ).toBe(
      [
        "## Oracle pairs",
        "",
        "| Oracle phase | Discharged by | Authored | Discharged |",
        "| --- | --- | --- | --- |",
        "| phase-02 | phase-03 | pass | pass |",
        "| phase-04 | phase-05 | fail | not run |",
      ].join("\n"),
    );
  });

  it("renders nothing for no pair", () => {
    expect(renderOraclePairsSection([])).toBeUndefined();
  });
});

describe("dischargedOracleFiles", () => {
  it("gives the pair's files at the discharging phase only", () => {
    expect(dischargedOracleFiles(phases, "phase-04")).toEqual(["tests/prune.test.ts"]);
    for (const id of ["phase-01", "phase-02", "phase-03", "phase-05"]) {
      expect(dischargedOracleFiles(phases, id)).toEqual([]);
    }
  });
});
