import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { InvalidArtifactTransitionError } from "../../../src/domain/errors.js";
import {
  isTerminalStatus,
  legalTargetsFrom,
  parsePlanStatus,
  parseSpecStatus,
  PLAN_STATUSES,
  requestTransition,
  SPEC_STATUSES,
} from "../../../src/domain/artifact/status.js";

function assertRight<T>(result: Either.Either<T, unknown>, expected: T): void {
  expect(Either.isRight(result)).toBe(true);
  if (Either.isRight(result)) {
    expect(result.right).toBe(expected);
  }
}

function assertLeft(result: Either.Either<unknown, unknown>): void {
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(result.left).toBeInstanceOf(InvalidArtifactTransitionError);
  }
}

describe("spec transitions", () => {
  const SPEC_LEGAL: [string, string][] = [
    ["Draft", "Approved"],
    ["Draft", "Abandoned"],
    ["Approved", "Abandoned"],
    ["Approved", "Completed"],
  ];

  describe.each(SPEC_LEGAL)("%s → %s", (from, to) => {
    it("is legal", () => {
      assertRight(requestTransition("spec", from as never, to as never), to as never);
    });
  });

  it.each(SPEC_STATUSES)("rejects all illegal targets from %s", (from) => {
    const legal = new Set(legalTargetsFrom("spec", from));
    for (const to of SPEC_STATUSES) {
      if (legal.has(to)) continue;
      const result = requestTransition("spec", from, to);
      assertLeft(result);
      if (Either.isLeft(result)) {
        expect(result.left.legalTargets).toEqual(legalTargetsFrom("spec", from));
      }
    }
  });

  it("has no Stale status", () => {
    expect(SPEC_STATUSES).not.toContain("Stale");
  });

  it("Abandoned and Completed are terminal", () => {
    expect(isTerminalStatus("Abandoned")).toBe(true);
    expect(isTerminalStatus("Completed")).toBe(true);
  });

  it("Draft and Approved are not terminal", () => {
    expect(isTerminalStatus("Draft")).toBe(false);
    expect(isTerminalStatus("Approved")).toBe(false);
  });
});

describe("plan transitions", () => {
  const PLAN_LEGAL: [string, string][] = [
    ["Draft", "Approved"],
    ["Draft", "Abandoned"],
    ["Approved", "Approved"],
    ["Approved", "Stale"],
    ["Approved", "Abandoned"],
    ["Approved", "Completed"],
    ["Stale", "Approved"],
    ["Stale", "Draft"],
    ["Stale", "Abandoned"],
    ["Stale", "Completed"],
  ];

  describe.each(PLAN_LEGAL)("%s → %s", (from, to) => {
    it("is legal", () => {
      assertRight(requestTransition("plan", from as never, to as never), to as never);
    });
  });

  it.each(PLAN_STATUSES)("rejects all illegal targets from %s", (from) => {
    const legal = new Set(legalTargetsFrom("plan", from));
    for (const to of PLAN_STATUSES) {
      if (legal.has(to)) continue;
      const result = requestTransition("plan", from, to);
      assertLeft(result);
      if (Either.isLeft(result)) {
        expect(result.left.legalTargets).toEqual(legalTargetsFrom("plan", from));
      }
    }
  });

  it("re-approval (Approved → Approved) is legal", () => {
    assertRight(requestTransition("plan", "Approved", "Approved"), "Approved");
  });

  it("Abandoned and Completed are terminal", () => {
    expect(isTerminalStatus("Abandoned")).toBe(true);
    expect(isTerminalStatus("Completed")).toBe(true);
  });
});

describe("parseSpecStatus", () => {
  it("accepts every valid spec status", () => {
    for (const status of SPEC_STATUSES) {
      expect(parseSpecStatus(status)).toBe(status);
    }
  });

  it("rejects unknown values", () => {
    expect(parseSpecStatus("Stale")).toBeNull();
    expect(parseSpecStatus("draft")).toBeNull();
    expect(parseSpecStatus("")).toBeNull();
  });
});

describe("no back-compat for the retired Archived spelling", () => {
  it("parseSpecStatus and parsePlanStatus both reject the literal Archived", () => {
    expect(parseSpecStatus("Archived")).toBeNull();
    expect(parsePlanStatus("Archived")).toBeNull();
  });
});

describe("parsePlanStatus", () => {
  it("accepts every valid plan status", () => {
    for (const status of PLAN_STATUSES) {
      expect(parsePlanStatus(status)).toBe(status);
    }
  });

  it("rejects unknown values", () => {
    expect(parsePlanStatus("stale")).toBeNull();
    expect(parsePlanStatus("")).toBeNull();
  });
});
