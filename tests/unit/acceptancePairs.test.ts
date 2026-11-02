import { describe, expect, it } from "vitest";
import {
  acceptancePairs,
  acceptanceRoleOf,
  acceptanceSkipRefusal,
  latestAuthoredCommit,
  pairsChangedByCorrections,
  passedAcceptanceTestFiles,
  recordAcceptanceRole,
  renderAcceptancePairsSection,
  stopAcceptancePairs,
  stopSkipAcceptanceRefusal,
  type AuthoredCommitStatus,
} from "../../src/domain/plan/acceptancePairs.js";

// A five-phase plan with one pair: phase-02 authors tests/prune.test.ts and
// phase-04 passes it.
const phases = [
  { id: "phase-01", acceptance: null },
  { id: "phase-02", acceptance: { passedBy: "phase-04", files: ["tests/prune.test.ts"] } },
  { id: "phase-03", acceptance: null },
  { id: "phase-04", acceptance: null },
  { id: "phase-05", acceptance: null },
];

const pair = {
  acceptancePhase: "phase-02",
  passingPhase: "phase-04",
  files: ["tests/prune.test.ts"],
};

describe("acceptancePairs", () => {
  it("lists a pair per non-null acceptance, in plan order", () => {
    const two = [
      { id: "phase-01", acceptance: { passedBy: "phase-03", files: ["tests/refunds.test.ts"] } },
      { id: "phase-02", acceptance: null },
      { id: "phase-03", acceptance: null },
      { id: "phase-04", acceptance: { passedBy: "phase-05", files: ["tests/prune.test.ts"] } },
      { id: "phase-05", acceptance: null },
    ];
    expect(acceptancePairs(two).map((p) => [p.acceptancePhase, p.passingPhase])).toEqual([
      ["phase-01", "phase-03"],
      ["phase-04", "phase-05"],
    ]);
  });

  it("is empty for a plan without an acceptance phase", () => {
    expect(acceptancePairs(phases.map(({ id }) => ({ id, acceptance: null })))).toEqual([]);
  });
});

describe("acceptanceRoleOf", () => {
  it("names the acceptance phase and the passing phase, and no other", () => {
    expect(acceptanceRoleOf(phases, "phase-02")).toEqual({ role: "acceptance", pair });
    expect(acceptanceRoleOf(phases, "phase-04")).toEqual({ role: "passing", pair });
    for (const id of ["phase-01", "phase-03", "phase-05", "phase-09"]) {
      expect(acceptanceRoleOf(phases, id)).toBeNull();
    }
  });
});

describe("acceptanceSkipRefusal", () => {
  it("is null for an acceptance phase and a passing phase", () => {
    expect(acceptanceSkipRefusal(phases, "phase-02")).toBeNull();
    expect(acceptanceSkipRefusal(phases, "phase-04")).toBeNull();
  });

  it("refuses any other phase, naming it", () => {
    for (const id of ["phase-01", "phase-03", "phase-05"]) {
      expect(acceptanceSkipRefusal(phases, id)).toBe(
        `--skip-acceptance: ${id} is neither an acceptance phase nor a passing phase; it has no acceptance step to skip.`,
      );
    }
  });
});

describe("recordAcceptanceRole", () => {
  it("maps a role to the manifest's value", () => {
    expect(recordAcceptanceRole(acceptanceRoleOf(phases, "phase-02"))).toEqual({
      role: "acceptance",
      passedBy: "phase-04",
    });
    expect(recordAcceptanceRole(acceptanceRoleOf(phases, "phase-04"))).toEqual({
      role: "passing",
      acceptancePhase: "phase-02",
    });
    expect(recordAcceptanceRole(null)).toBeNull();
  });
});

describe("renderAcceptancePairsSection", () => {
  it("renders one table row per pair", () => {
    expect(
      renderAcceptancePairsSection([
        {
          acceptancePhase: "phase-02",
          passingPhase: "phase-03",
          authored: "pass",
          passed: "pass",
        },
        {
          acceptancePhase: "phase-04",
          passingPhase: "phase-05",
          authored: "fail",
          passed: "not run",
        },
      ]),
    ).toBe(
      [
        "## Acceptance pairs",
        "",
        "| Acceptance phase | Passed by | Authored | Passed |",
        "| --- | --- | --- | --- |",
        "| phase-02 | phase-03 | pass | pass |",
        "| phase-04 | phase-05 | fail | not run |",
      ].join("\n"),
    );
  });

  it("renders nothing for no pair", () => {
    expect(renderAcceptancePairsSection([])).toBeUndefined();
  });
});

describe("passedAcceptanceTestFiles", () => {
  it("gives the pair's files at the passing phase only", () => {
    expect(passedAcceptanceTestFiles(phases, "phase-04")).toEqual(["tests/prune.test.ts"]);
    for (const id of ["phase-01", "phase-02", "phase-03", "phase-05"]) {
      expect(passedAcceptanceTestFiles(phases, id)).toEqual([]);
    }
  });
});

describe("stopSkipAcceptanceRefusal", () => {
  it.each([
    ["the acceptance phase", "phase-02"],
    ["a phase strictly between", "phase-03"],
    ["the passing phase", "phase-04"],
  ])("names the run and the stop at %s of a pair", (_name, phaseId) => {
    expect(stopSkipAcceptanceRefusal(phases, "invoice-export", phaseId)).toBe(
      `--skip-acceptance: invoice-export awaits review at ${phaseId}; a close's authored acceptance step is never skipped. Undo the acceptance-test-file correction, or reset the stop.`,
    );
  });

  it.each(["phase-01", "phase-05"])(
    "gives a stop at %s, in no pair, the no-acceptance-step refusal",
    (phaseId) => {
      expect(stopSkipAcceptanceRefusal(phases, "invoice-export", phaseId)).toBe(
        acceptanceSkipRefusal(phases, phaseId),
      );
    },
  );
});

describe("stopAcceptancePairs", () => {
  it.each([
    ["the acceptance phase", "phase-02", [pair]],
    ["a phase strictly between", "phase-03", [pair]],
    ["the passing phase", "phase-04", []],
    ["a phase before the pair", "phase-01", []],
    ["a phase after the pair", "phase-05", []],
    ["a phase the plan does not have", "phase-09", []],
  ])("a stop at %s", (_label, stop, expected) => {
    expect(stopAcceptancePairs(phases, stop)).toEqual(expected);
  });

  it("lists every pair a stop sits in, in plan order", () => {
    const overlapping = [
      { id: "phase-01", acceptance: { passedBy: "phase-04", files: ["tests/refunds.test.ts"] } },
      { id: "phase-02", acceptance: { passedBy: "phase-03", files: ["tests/prune.test.ts"] } },
      { id: "phase-03", acceptance: null },
      { id: "phase-04", acceptance: null },
    ];
    expect(stopAcceptancePairs(overlapping, "phase-02").map((p) => p.acceptancePhase)).toEqual([
      "phase-01",
      "phase-02",
    ]);
    // phase-03 passes phase-02's pair, so it sits only in phase-01's.
    expect(stopAcceptancePairs(overlapping, "phase-03").map((p) => p.acceptancePhase)).toEqual([
      "phase-01",
    ]);
  });
});

describe("pairsChangedByCorrections", () => {
  const other = {
    acceptancePhase: "phase-05",
    passingPhase: "phase-06",
    files: ["tests/a.test.ts"],
  };

  it.each([
    ["an acceptance test file", ["src/prune.ts", "tests/prune.test.ts"], [pair]],
    ["no acceptance test file", ["src/prune.ts"], []],
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
  acceptanceStep: "authored",
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
    acceptanceStep: "authored",
    closedBy: { name: "Ada Example", email: "ada@example.com" },
  };

  it.each<readonly [string, readonly AuthoredCommitStatus[], string | null]>([
    [
      "no stop: the acceptance phase's commit",
      [status("phase-02", C2), status("phase-03", C3)],
      C2,
    ],
    [
      "a declared authored stop: its commit",
      [status("phase-02", C2), status("phase-03", C3, declaredAuthored)],
      C3,
    ],
    [
      "a held authored stop at the acceptance phase: its review commit",
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
      "a corrected stop that ran no acceptance step is ignored",
      [
        status("phase-02", C2),
        status("phase-03", C3, {
          cause: "held",
          status: "closed",
          outcome: "corrected",
          reviewCommit: R3,
          acceptanceStep: "none",
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
      "the passing phase's own authored stop is ignored",
      [status("phase-02", C2), status("phase-04", "d4".repeat(20), heldAuthored(R3))],
      C2,
    ],
    ["no commit noted by the acceptance phase", [status("phase-02", undefined)], null],
  ])("%s", (_label, statuses, expected) => {
    expect(latestAuthoredCommit(pair, phases, statuses)).toBe(expected);
  });
});
