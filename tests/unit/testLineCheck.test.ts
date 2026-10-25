import { describe, it, expect } from "vitest";
import {
  testLineFindings,
  type CriteriaInput,
  type TestLineCheckPhase,
} from "../../src/domain/plan/testLineCheck.js";

const ORACLE = { dischargedBy: "phase-02", files: ["tests/a.test.ts"] };
const criteria = (...ids: string[]): CriteriaInput => ({ kind: "criteria", slug: "spec-x", ids });
const NONE: CriteriaInput = { kind: "no-source-spec" };

const phase = (
  id: string,
  oracle: object | null,
  ...lines: Array<[item: number, loop: "oracle" | "in-phase", criterion: string | null]>
): TestLineCheckPhase => ({
  id,
  oracle,
  lines: lines.map(([item, loop, criterion]) => ({ item, loop, criterion })),
});

const row = (severity: "error" | "warning", phaseId: string | null, message: string) => ({
  severity,
  check: "tests",
  phase: phaseId,
  message,
});

describe("testLineFindings", () => {
  it("flags an oracle-loop line on a phase that is not an oracle phase", () => {
    expect(
      testLineFindings({ phases: [phase("phase-01", null, [3, "oracle", null])], criteria: NONE }),
    ).toEqual([
      row(
        "error",
        "phase-01",
        "test line 3 is in the oracle loop, but phase-01 is not an oracle phase",
      ),
    ]);
  });

  it("flags an oracle phase with no oracle-loop line, none at all included", () => {
    expect(
      testLineFindings({
        phases: [phase("phase-01", ORACLE, [1, "in-phase", null]), phase("phase-02", ORACLE)],
        criteria: NONE,
      }),
    ).toEqual([
      row(
        "error",
        "phase-01",
        "phase-01 is an oracle phase, but none of its test lines is in the oracle loop",
      ),
      row(
        "error",
        "phase-02",
        "phase-02 is an oracle phase, but none of its test lines is in the oracle loop",
      ),
    ]);
  });

  it("flags an unknown criterion by its source item number", () => {
    expect(
      testLineFindings({
        phases: [phase("phase-01", null, [2, "in-phase", "ac-z"], [5, "in-phase", "ac-a"])],
        criteria: criteria("ac-a"),
      }),
    ).toEqual([
      row("error", "phase-01", 'test line 2 names criterion "ac-z", which spec-x does not have'),
    ]);
  });

  it("warns once per uncovered criterion, in spec order, after every phase finding", () => {
    expect(
      testLineFindings({
        phases: [
          phase("phase-01", null, [1, "oracle", "ac-z"]),
          phase("phase-02", ORACLE, [1, "in-phase", "ac-b"]),
        ],
        criteria: criteria("ac-a", "ac-b", "ac-c"),
      }),
    ).toEqual([
      row(
        "error",
        "phase-01",
        "test line 1 is in the oracle loop, but phase-01 is not an oracle phase",
      ),
      row("error", "phase-01", 'test line 1 names criterion "ac-z", which spec-x does not have'),
      row(
        "error",
        "phase-02",
        "phase-02 is an oracle phase, but none of its test lines is in the oracle loop",
      ),
      row("warning", null, 'criterion "ac-a" of spec-x is named by no test line'),
      row("warning", null, 'criterion "ac-c" of spec-x is named by no test line'),
    ]);
  });

  it("puts a line's oracle-loop error before its unknown-criterion error, then the phase's silent-oracle error", () => {
    const messages = testLineFindings({
      phases: [phase("phase-01", null, [1, "oracle", "ac-z"]), phase("phase-02", ORACLE)],
      criteria: criteria("ac-a"),
    }).map((f) => f.message);
    expect(messages.slice(0, 3)).toEqual([
      "test line 1 is in the oracle loop, but phase-01 is not an oracle phase",
      'test line 1 names criterion "ac-z", which spec-x does not have',
      "phase-02 is an oracle phase, but none of its test lines is in the oracle loop",
    ]);
  });

  it("gives an unreadable source spec as one plan-level warning and checks no criterion", () => {
    expect(
      testLineFindings({
        phases: [phase("phase-01", null, [1, "in-phase", "ac-z"])],
        criteria: { kind: "no-criterion-ids", reason: "no-sidecar", message: "the reader's line" },
      }),
    ).toEqual([row("warning", null, "the reader's line")]);
  });

  it("gives no criterion finding to a plan with no source spec, whatever its lines name", () => {
    expect(
      testLineFindings({
        phases: [phase("phase-01", null, [1, "in-phase", "ac-z"])],
        criteria: NONE,
      }),
    ).toEqual([]);
  });

  it("gives no finding to an empty last phase", () => {
    expect(
      testLineFindings({
        phases: [phase("phase-01", null, [1, "in-phase", "ac-a"]), phase("phase-02", null)],
        criteria: criteria("ac-a"),
      }),
    ).toEqual([]);
  });

  it("numbers kept lines by source item when a departing item precedes them", () => {
    expect(
      testLineFindings({ phases: [phase("phase-01", null, [2, "oracle", null])], criteria: NONE }),
    ).toEqual([
      row(
        "error",
        "phase-01",
        "test line 2 is in the oracle loop, but phase-01 is not an oracle phase",
      ),
    ]);
  });
});
