import { describe, expect, it } from "vitest";
import { verifiedSurfaces } from "../../src/domain/gate/verifiedSurfaces.js";
import type { GateAttribution } from "../../src/schemas/gateAttribution.js";

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
});
