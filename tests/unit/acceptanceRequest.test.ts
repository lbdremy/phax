import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  acceptanceRequestPathFor,
  makeAcceptanceRequest,
  makeReviewAcceptanceRequest,
} from "../../src/domain/gate/acceptanceRequest.js";
import { oracleRoleOf } from "../../src/domain/plan/oraclePairs.js";
import { decodeAcceptanceRequestFile } from "../../src/schemas/acceptanceRequest.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";

const base = "0123456789abcdef0123456789abcdef01234567";
const acceptanceCommit = "89abcdef0123456789abcdef0123456789abcdef";

// acme-billing's refunds plan: phase-02 pins two acceptance test files, phase-03 passes them.
const phases = [
  { id: "phase-01", acceptance: null },
  {
    id: "phase-02",
    acceptance: { passedBy: "phase-03", files: ["tests/refunds.test.ts", "tests/prune.test.ts"] },
  },
  { id: "phase-03", acceptance: null },
];

function roleOf(id: string) {
  const role = oracleRoleOf(phases, id);
  if (role === null) throw new Error(`${id} has no acceptance role`);
  return role;
}

describe("makeAcceptanceRequest", () => {
  it("asks for an authored verdict at the acceptance phase, with no acceptanceCommit", () => {
    const request = makeAcceptanceRequest({
      role: roleOf("phase-02"),
      phaseId: "phase-02",
      base,
      acceptanceCommit: null,
    });
    expect(request).toEqual({
      verdict: "authored",
      phase: "phase-02",
      acceptancePhase: "phase-02",
      base,
      files: ["tests/refunds.test.ts", "tests/prune.test.ts"],
    });
    expect(Object.keys(request)).toEqual(["verdict", "phase", "acceptancePhase", "base", "files"]);
  });

  it("asks for a passed verdict at the passing phase, against the acceptance phase", () => {
    const request = makeAcceptanceRequest({
      role: roleOf("phase-03"),
      phaseId: "phase-03",
      base,
      acceptanceCommit,
    });
    expect(request).toEqual({
      verdict: "passed",
      phase: "phase-03",
      acceptancePhase: "phase-02",
      base,
      acceptanceCommit,
      files: ["tests/refunds.test.ts", "tests/prune.test.ts"],
    });
    expect(Object.keys(request)).toEqual([
      "verdict",
      "phase",
      "acceptancePhase",
      "base",
      "acceptanceCommit",
      "files",
    ]);
  });

  it("refuses a passed request without the acceptance phase's commit", () => {
    expect(() =>
      makeAcceptanceRequest({
        role: roleOf("phase-03"),
        phaseId: "phase-03",
        base,
        acceptanceCommit: null,
      }),
    ).toThrow(/phase-02/);
  });

  it("builds requests the acceptance-request format accepts", () => {
    for (const [id, commit] of [
      ["phase-02", null],
      ["phase-03", acceptanceCommit],
    ] as const) {
      const request = makeAcceptanceRequest({
        role: roleOf(id),
        phaseId: id,
        base,
        acceptanceCommit: commit,
      });
      expect(
        Either.isRight(decodeAcceptanceRequestFile(withSchemaUrl("acceptance-request", request))),
      ).toBe(true);
    }
  });
});

describe("makeReviewAcceptanceRequest", () => {
  it("asks for an authored verdict naming the stopped phase, against the acceptance phase", () => {
    const role = roleOf("phase-02");
    // A stop at the acceptance phase itself, then one made-up phase between the pair.
    const request = makeReviewAcceptanceRequest({ pair: role.pair, phaseId: "phase-02", base });
    expect(request).toEqual({
      verdict: "authored",
      phase: "phase-02",
      acceptancePhase: "phase-02",
      base,
      files: ["tests/refunds.test.ts", "tests/prune.test.ts"],
    });
    const between = makeReviewAcceptanceRequest({ pair: role.pair, phaseId: "phase-07", base });
    expect(between).toEqual({ ...request, phase: "phase-07" });
    expect(Object.keys(between)).toEqual(["verdict", "phase", "acceptancePhase", "base", "files"]);
    expect(
      Either.isRight(decodeAcceptanceRequestFile(withSchemaUrl("acceptance-request", between))),
    ).toBe(true);
  });
});

describe("acceptanceRequestPathFor", () => {
  it("names the request beside the attempt log", () => {
    expect(acceptanceRequestPathFor("/run/phase-02/checks-attempt-01.log")).toBe(
      "/run/phase-02/checks-attempt-01.acceptance-request.json",
    );
    expect(acceptanceRequestPathFor("/run/attempt")).toBe("/run/attempt.acceptance-request.json");
  });
});
