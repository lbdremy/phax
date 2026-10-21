import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { makeOracleRequest, oracleRequestPathFor } from "../../src/domain/gate/oracleRequest.js";
import { oracleRoleOf } from "../../src/domain/plan/oraclePairs.js";
import { decodeOracleRequestFile } from "../../src/schemas/oracleRequest.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";

const base = "0123456789abcdef0123456789abcdef01234567";
const oracleCommit = "89abcdef0123456789abcdef0123456789abcdef";

// acme-billing's refunds plan: phase-02 pins two oracle files, phase-03 discharges them.
const phases = [
  { id: "phase-01", oracle: null },
  {
    id: "phase-02",
    oracle: { dischargedBy: "phase-03", files: ["tests/refunds.test.ts", "tests/prune.test.ts"] },
  },
  { id: "phase-03", oracle: null },
];

function roleOf(id: string) {
  const role = oracleRoleOf(phases, id);
  if (role === null) throw new Error(`${id} has no oracle role`);
  return role;
}

describe("makeOracleRequest", () => {
  it("asks for an authored verdict at the oracle phase, with no oracleCommit", () => {
    const request = makeOracleRequest({
      role: roleOf("phase-02"),
      phaseId: "phase-02",
      base,
      oracleCommit: null,
    });
    expect(request).toEqual({
      verdict: "authored",
      phase: "phase-02",
      oraclePhase: "phase-02",
      base,
      files: ["tests/refunds.test.ts", "tests/prune.test.ts"],
    });
    expect(Object.keys(request)).toEqual(["verdict", "phase", "oraclePhase", "base", "files"]);
  });

  it("asks for a discharged verdict at the discharging phase, against the oracle phase", () => {
    const request = makeOracleRequest({
      role: roleOf("phase-03"),
      phaseId: "phase-03",
      base,
      oracleCommit,
    });
    expect(request).toEqual({
      verdict: "discharged",
      phase: "phase-03",
      oraclePhase: "phase-02",
      base,
      oracleCommit,
      files: ["tests/refunds.test.ts", "tests/prune.test.ts"],
    });
    expect(Object.keys(request)).toEqual([
      "verdict",
      "phase",
      "oraclePhase",
      "base",
      "oracleCommit",
      "files",
    ]);
  });

  it("refuses a discharge without the oracle phase's commit", () => {
    expect(() =>
      makeOracleRequest({
        role: roleOf("phase-03"),
        phaseId: "phase-03",
        base,
        oracleCommit: null,
      }),
    ).toThrow(/phase-02/);
  });

  it("builds requests the oracle-request format accepts", () => {
    for (const [id, commit] of [
      ["phase-02", null],
      ["phase-03", oracleCommit],
    ] as const) {
      const request = makeOracleRequest({
        role: roleOf(id),
        phaseId: id,
        base,
        oracleCommit: commit,
      });
      expect(
        Either.isRight(decodeOracleRequestFile(withSchemaUrl("oracle-request", request))),
      ).toBe(true);
    }
  });
});

describe("oracleRequestPathFor", () => {
  it("names the request beside the attempt log", () => {
    expect(oracleRequestPathFor("/run/phase-02/checks-attempt-01.log")).toBe(
      "/run/phase-02/checks-attempt-01.oracle-request.json",
    );
    expect(oracleRequestPathFor("/run/attempt")).toBe("/run/attempt.oracle-request.json");
  });
});
