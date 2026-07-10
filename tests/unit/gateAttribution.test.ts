import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeGateAttribution,
  encodeGateAttribution,
  type GateAttribution,
} from "../../src/schemas/gateAttribution.js";

describe("GateAttributionSchema", () => {
  const valid: GateAttribution = {
    phase: "phase-01",
    steps: [
      { command: "pnpm test", surface: "local", result: "pass" },
      { command: "pnpm lint", surface: "local", result: "fail" },
    ],
  };

  it("decodes a valid attribution record", () => {
    const result = decodeGateAttribution(valid);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual(valid);
    }
  });

  it("encodes back to the same shape", () => {
    const decoded = decodeGateAttribution(valid);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      const encoded = encodeGateAttribution(decoded.right);
      expect(encoded).toEqual(valid);
    }
  });

  it("round-trips through JSON", () => {
    const encoded = encodeGateAttribution(valid);
    const json = JSON.parse(JSON.stringify(encoded)) as unknown;
    const decoded = decodeGateAttribution(json);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right).toEqual(valid);
    }
  });

  it("accepts empty steps array", () => {
    const result = decodeGateAttribution({ phase: "phase-01", steps: [] });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects missing phase", () => {
    const result = decodeGateAttribution({ steps: [] });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects empty phase string", () => {
    const result = decodeGateAttribution({ phase: "", steps: [] });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects invalid result value", () => {
    const result = decodeGateAttribution({
      phase: "phase-01",
      steps: [{ command: "pnpm test", surface: "local", result: "unknown" }],
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects empty command string", () => {
    const result = decodeGateAttribution({
      phase: "phase-01",
      steps: [{ command: "", surface: "local", result: "pass" }],
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("decodes multiple steps with mixed results", () => {
    const multi: GateAttribution = {
      phase: "phase-02",
      steps: [
        { command: "pnpm format:check", surface: "local", result: "pass" },
        { command: "pnpm typecheck", surface: "local", result: "pass" },
        { command: "pnpm build", surface: "product", result: "fail" },
      ],
    };
    const result = decodeGateAttribution(multi);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.steps).toHaveLength(3);
      expect(result.right.steps[2]?.result).toBe("fail");
    }
  });
});
