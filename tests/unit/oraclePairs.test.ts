import { describe, expect, it } from "vitest";
import {
  dischargedOracleFiles,
  latestAuthoredCommit,
  oraclePairs,
  oracleRoleOf,
  oracleSkipRefusal,
  pairsChangedByCorrections,
  recordOracleRole,
  renderOraclePairsSection,
  stopOraclePairs,
  stopSkipOracleRefusal,
  type AuthoredCommitStatus,
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

describe("oracleSkipRefusal", () => {
  it("is null for an oracle phase and a discharging phase", () => {
    expect(oracleSkipRefusal(phases, "phase-02")).toBeNull();
    expect(oracleSkipRefusal(phases, "phase-04")).toBeNull();
  });

  it("refuses any other phase, naming it", () => {
    for (const id of ["phase-01", "phase-03", "phase-05"]) {
      expect(oracleSkipRefusal(phases, id)).toBe(
        `--skip-oracle: ${id} is neither an oracle phase nor a discharging phase; it has no oracle step to skip.`,
      );
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

describe("stopSkipOracleRefusal", () => {
  it.each([
    ["the oracle phase", "phase-02"],
    ["a phase strictly between", "phase-03"],
    ["the discharging phase", "phase-04"],
  ])("names the run and the stop at %s of a pair", (_name, phaseId) => {
    expect(stopSkipOracleRefusal(phases, "invoice-export", phaseId)).toBe(
      `--skip-oracle: invoice-export awaits review at ${phaseId}; a close's authored oracle step is never skipped. Undo the oracle-file correction, or reset the stop.`,
    );
  });

  it.each(["phase-01", "phase-05"])(
    "gives a stop at %s, in no pair, the no-oracle-step refusal",
    (phaseId) => {
      expect(stopSkipOracleRefusal(phases, "invoice-export", phaseId)).toBe(
        oracleSkipRefusal(phases, phaseId),
      );
    },
  );
});

describe("stopOraclePairs", () => {
  it.each([
    ["the oracle phase", "phase-02", [pair]],
    ["a phase strictly between", "phase-03", [pair]],
    ["the discharging phase", "phase-04", []],
    ["a phase before the pair", "phase-01", []],
    ["a phase after the pair", "phase-05", []],
    ["a phase the plan does not have", "phase-09", []],
  ])("a stop at %s", (_label, stop, expected) => {
    expect(stopOraclePairs(phases, stop)).toEqual(expected);
  });

  it("lists every pair a stop sits in, in plan order", () => {
    const overlapping = [
      { id: "phase-01", oracle: { dischargedBy: "phase-04", files: ["tests/refunds.test.ts"] } },
      { id: "phase-02", oracle: { dischargedBy: "phase-03", files: ["tests/prune.test.ts"] } },
      { id: "phase-03", oracle: null },
      { id: "phase-04", oracle: null },
    ];
    expect(stopOraclePairs(overlapping, "phase-02").map((p) => p.oraclePhase)).toEqual([
      "phase-01",
      "phase-02",
    ]);
    // phase-03 discharges phase-02's pair, so it sits only in phase-01's.
    expect(stopOraclePairs(overlapping, "phase-03").map((p) => p.oraclePhase)).toEqual([
      "phase-01",
    ]);
  });
});

describe("pairsChangedByCorrections", () => {
  const other = {
    oraclePhase: "phase-05",
    dischargingPhase: "phase-06",
    files: ["tests/a.test.ts"],
  };

  it.each([
    ["an oracle file", ["src/prune.ts", "tests/prune.test.ts"], [pair]],
    ["no oracle file", ["src/prune.ts"], []],
    ["nothing", [], []],
    ["both pairs' files", ["tests/a.test.ts", "tests/prune.test.ts"], [pair, other]],
  ])("keeps the pairs whose files the corrections change: %s", (_label, paths, expected) => {
    expect(pairsChangedByCorrections([pair, other], paths)).toEqual(expected);
  });
});

type Stop = AuthoredCommitStatus["stop"];

const status = (
  phaseId: string,
  commitHash: string | undefined,
  stop: Stop = null,
): AuthoredCommitStatus => ({ phaseId, commitHash, stop });

const heldAuthored = (reviewCommit: string): Stop => ({
  cause: "held",
  status: "closed",
  outcome: "corrected",
  reviewCommit,
  oracleStep: "authored",
  closedBy: { name: "Ada Example", email: "ada@example.com" },
});

describe("latestAuthoredCommit", () => {
  const C2 = "c2".repeat(20);
  const C3 = "c3".repeat(20);
  const R2 = "a2".repeat(20);
  const R3 = "a3".repeat(20);

  const declaredAuthored: Stop = {
    cause: "declared",
    status: "closed",
    outcome: "corrected",
    oracleStep: "authored",
    closedBy: { name: "Ada Example", email: "ada@example.com" },
  };

  it.each<readonly [string, readonly AuthoredCommitStatus[], string | null]>([
    ["no stop: the oracle phase's commit", [status("phase-02", C2), status("phase-03", C3)], C2],
    [
      "a declared authored stop: its commit",
      [status("phase-02", C2), status("phase-03", C3, declaredAuthored)],
      C3,
    ],
    [
      "a held authored stop at the oracle phase: its review commit",
      [status("phase-02", C2, heldAuthored(R2)), status("phase-03", C3)],
      R2,
    ],
    [
      "a later held authored stop over an earlier one",
      [status("phase-02", C2, heldAuthored(R2)), status("phase-03", C3, heldAuthored(R3))],
      R3,
    ],
    [
      "a later declared stop over an earlier held one",
      [status("phase-02", C2, heldAuthored(R2)), status("phase-03", C3, declaredAuthored)],
      C3,
    ],
    [
      "an unchanged stop is ignored",
      [
        status("phase-02", C2),
        status("phase-03", C3, {
          cause: "held",
          status: "closed",
          outcome: "unchanged",
          closedBy: { name: "Ada Example", email: "ada@example.com" },
        }),
      ],
      C2,
    ],
    [
      "a corrected stop that ran no oracle step is ignored",
      [
        status("phase-02", C2),
        status("phase-03", C3, {
          cause: "held",
          status: "closed",
          outcome: "corrected",
          reviewCommit: R3,
          oracleStep: "none",
          closedBy: { name: "Ada Example", email: "ada@example.com" },
        }),
      ],
      C2,
    ],
    [
      "a waiting stop is ignored",
      [status("phase-02", C2), status("phase-03", C3, { cause: "held", status: "waiting" })],
      C2,
    ],
    [
      "the discharge's own authored stop is ignored",
      [status("phase-02", C2), status("phase-04", "d4".repeat(20), heldAuthored(R3))],
      C2,
    ],
    ["no commit noted by the oracle phase", [status("phase-02", undefined)], null],
  ])("%s", (_label, statuses, expected) => {
    expect(latestAuthoredCommit(pair, phases, statuses)).toBe(expected);
  });
});
