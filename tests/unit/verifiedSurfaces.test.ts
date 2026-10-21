import { describe, expect, it } from "vitest";
import { runVerifiedSurfaces, verifiedSurfaces } from "../../src/domain/gate/verifiedSurfaces.js";
import type { GateAttribution } from "../../src/schemas/gateAttribution.js";

const withOracle = (result: "pass" | "fail" | "refused" | "skipped"): GateAttribution => ({
  phase: "phase-02",
  steps: [
    { command: "pnpm test", surface: "structural", result: "pass" },
    { command: "pnpm lint", surface: "local", result: "pass" },
    { command: "oracles provider", surface: "oracle", result },
  ],
});

describe("verifiedSurfaces", () => {
  it("marks a surface verified when every step of it passed", () => {
    const record: GateAttribution = {
      phase: "phase-01",
      steps: [
        { command: "pnpm format", surface: "local", result: "pass" },
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "pnpm build", surface: "product", result: "pass" },
      ],
    };

    expect(verifiedSurfaces(record)).toEqual(["local", "product"]);
  });

  it("excludes a surface with any failing step, even alongside passes", () => {
    const record: GateAttribution = {
      phase: "phase-01",
      steps: [
        { command: "pnpm format", surface: "local", result: "pass" },
        { command: "pnpm test", surface: "local", result: "fail" },
      ],
    };

    expect(verifiedSurfaces(record)).toEqual([]);
  });

  it("excludes a surface that never ran", () => {
    const record: GateAttribution = {
      phase: "phase-01",
      steps: [{ command: "pnpm format", surface: "local", result: "pass" }],
    };

    const result = verifiedSurfaces(record);

    expect(result).toContain("local");
    expect(result).not.toContain("structural");
    expect(result).not.toContain("product");
  });

  it("returns an empty array for a record with no steps", () => {
    expect(verifiedSurfaces({ phase: "phase-01", steps: [] })).toEqual([]);
  });

  it("sorts and dedupes the output", () => {
    const record: GateAttribution = {
      phase: "phase-01",
      steps: [
        { command: "pnpm build", surface: "product", result: "pass" },
        { command: "pnpm audit:architecture", surface: "structural", result: "pass" },
        { command: "pnpm format", surface: "local", result: "pass" },
        { command: "pnpm test", surface: "local", result: "pass" },
      ],
    };

    expect(verifiedSurfaces(record)).toEqual(["local", "product", "structural"]);
  });

  it("verifies the configured surfaces of a record whose oracle step was skipped, not oracle", () => {
    expect(verifiedSurfaces(withOracle("skipped"))).toEqual(["local", "structural"]);
  });

  it("verifies the oracle surface only when its step passed", () => {
    expect(verifiedSurfaces(withOracle("pass"))).toEqual(["local", "oracle", "structural"]);
    expect(verifiedSurfaces(withOracle("fail"))).toEqual(["local", "structural"]);
    expect(verifiedSurfaces(withOracle("refused"))).toEqual(["local", "structural"]);
  });
});

describe("runVerifiedSurfaces", () => {
  it("is the sorted union of each record's verified surfaces", () => {
    const records: GateAttribution[] = [
      { phase: "phase-01", steps: [{ command: "pnpm build", surface: "product", result: "pass" }] },
      { phase: "phase-02", steps: [{ command: "pnpm format", surface: "local", result: "pass" }] },
      withOracle("pass"),
    ];

    expect(runVerifiedSurfaces(records)).toEqual(["local", "oracle", "product", "structural"]);
  });

  it("drops a surface any record skipped, even when another record verified it", () => {
    const records = [withOracle("pass"), { ...withOracle("skipped"), phase: "phase-03" }];

    expect(runVerifiedSurfaces(records)).toEqual(["local", "structural"]);
  });

  it("is empty for no records", () => {
    expect(runVerifiedSurfaces([])).toEqual([]);
  });
});
