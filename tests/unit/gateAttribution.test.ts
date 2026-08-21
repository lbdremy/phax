import { describe, expect, it } from "vitest";
import { Either } from "effect";
import {
  decodeGateAttribution,
  encodeGateAttribution,
  type GateAttribution,
} from "../../src/schemas/gateAttribution.js";

describe("GateAttributionSchema", () => {
  it("round-trips a record through encode/decode", () => {
    const record: GateAttribution = {
      phase: "phase-01",
      steps: [
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "pnpm audit:architecture", surface: "structural", result: "fail" },
      ],
    };

    const encoded = encodeGateAttribution(record);
    const decoded = decodeGateAttribution(encoded);

    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right).toEqual(record);
    }
  });

  it("decodes an empty steps array", () => {
    const decoded = decodeGateAttribution({ phase: "phase-01", steps: [] });

    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.steps).toEqual([]);
    }
  });

  it("rejects a step whose surface is outside local | structural | product", () => {
    const decoded = decodeGateAttribution({
      phase: "phase-01",
      steps: [{ command: "pnpm test", surface: "bogus", result: "pass" }],
    });

    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a step whose result is outside pass | fail", () => {
    const decoded = decodeGateAttribution({
      phase: "phase-01",
      steps: [{ command: "pnpm test", surface: "local", result: "skipped" }],
    });

    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a missing phase", () => {
    const decoded = decodeGateAttribution({ steps: [] });

    expect(Either.isLeft(decoded)).toBe(true);
  });
});
