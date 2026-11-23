import { describe, expect, it } from "vitest";
import { runVerifiedSurfaces, verifiedSurfaces } from "../../src/domain/gate/verifiedSurfaces.js";
import type { GateAttribution, GateStepResult } from "../../src/schemas/gateAttribution.js";
import type { RecordedSurface } from "../../src/schemas/surface.js";

type Surface = Exclude<RecordedSurface, "acceptance">;

const UNKNOWN = { kind: "unknown" } as const;

/** A configured step whose time is beside the point here. */
const step = (
  command: string,
  surface: Surface,
  result: "pass" | "fail" | "refused",
): GateStepResult => ({ command, surface, result, time: UNKNOWN });

/** A record of the given steps, the attempt's time unknown. */
const record = (phase: string, steps: readonly GateStepResult[]): GateAttribution => ({
  phase,
  time: UNKNOWN,
  steps,
  protectedPaths: null,
});

const withOracle = (result: "pass" | "fail" | "refused" | "skipped"): GateAttribution =>
  record("phase-02", [
    step("pnpm test", "structural", "pass"),
    step("pnpm lint", "local", "pass"),
    result === "skipped"
      ? { command: "oracles provider", surface: "acceptance", result, time: { kind: "not-run" } }
      : { command: "oracles provider", surface: "acceptance", result, time: UNKNOWN },
  ]);

describe("verifiedSurfaces", () => {
  it("marks a surface verified when every step of it passed", () => {
    const attribution = record("phase-01", [
      step("pnpm format", "local", "pass"),
      step("pnpm test", "local", "pass"),
      step("pnpm build", "product", "pass"),
    ]);

    expect(verifiedSurfaces(attribution)).toEqual(["local", "product"]);
  });

  it("excludes a surface with any failing step, even alongside passes", () => {
    const attribution = record("phase-01", [
      step("pnpm format", "local", "pass"),
      step("pnpm test", "local", "fail"),
    ]);

    expect(verifiedSurfaces(attribution)).toEqual([]);
  });

  it("excludes a surface that never ran", () => {
    const attribution = record("phase-01", [step("pnpm format", "local", "pass")]);

    const result = verifiedSurfaces(attribution);

    expect(result).toContain("local");
    expect(result).not.toContain("structural");
    expect(result).not.toContain("product");
  });

  it("returns an empty array for a record with no steps", () => {
    expect(verifiedSurfaces(record("phase-01", []))).toEqual([]);
  });

  it("sorts and dedupes the output", () => {
    const attribution = record("phase-01", [
      step("pnpm build", "product", "pass"),
      step("pnpm audit:architecture", "structural", "pass"),
      step("pnpm format", "local", "pass"),
      step("pnpm test", "local", "pass"),
    ]);

    expect(verifiedSurfaces(attribution)).toEqual(["local", "product", "structural"]);
  });

  it("verifies the configured surfaces of a record whose oracle step was skipped, not oracle", () => {
    expect(verifiedSurfaces(withOracle("skipped"))).toEqual(["local", "structural"]);
  });

  it("verifies the oracle surface only when its step passed", () => {
    expect(verifiedSurfaces(withOracle("pass"))).toEqual(["acceptance", "local", "structural"]);
    expect(verifiedSurfaces(withOracle("fail"))).toEqual(["local", "structural"]);
    expect(verifiedSurfaces(withOracle("refused"))).toEqual(["local", "structural"]);
  });
});

describe("runVerifiedSurfaces", () => {
  it("is the sorted union of each record's verified surfaces", () => {
    const records: GateAttribution[] = [
      record("phase-01", [step("pnpm build", "product", "pass")]),
      record("phase-02", [step("pnpm format", "local", "pass")]),
      withOracle("pass"),
    ];

    expect(runVerifiedSurfaces(records)).toEqual(["acceptance", "local", "product", "structural"]);
  });

  it("drops a surface any record skipped, even when another record verified it", () => {
    const records = [withOracle("pass"), { ...withOracle("skipped"), phase: "phase-03" }];

    expect(runVerifiedSurfaces(records)).toEqual(["local", "structural"]);
  });

  it("is empty for no records", () => {
    expect(runVerifiedSurfaces([])).toEqual([]);
  });
});
