import { describe, expect, it } from "vitest";
import { Either } from "effect";
import {
  decodeGateAttributionFile,
  encodeGateAttributionFile,
  type GateAttribution,
} from "../../src/schemas/gateAttribution.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";

function stamped<T extends object>(value: T) {
  return withSchemaUrl("gate-attribution", value);
}

describe("GateAttributionFileSchema", () => {
  it("round-trips a record through encode/decode, $schema first", () => {
    const record: GateAttribution = {
      phase: "phase-01",
      steps: [
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "pnpm audit:architecture", surface: "structural", result: "fail" },
      ],
    };

    const encoded = encodeGateAttributionFile(stamped(record));
    expect(Object.keys(encoded)[0]).toBe("$schema");
    const decoded = decodeGateAttributionFile(encoded);

    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right).toEqual(stamped(record));
    }
  });

  it("decodes an empty steps array", () => {
    const decoded = decodeGateAttributionFile(stamped({ phase: "phase-01", steps: [] }));

    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.steps).toEqual([]);
    }
  });

  it("rejects a document without $schema", () => {
    expect(Either.isLeft(decodeGateAttributionFile({ phase: "phase-01", steps: [] }))).toBe(true);
  });

  it("rejects a step whose surface is outside local | structural | product", () => {
    const decoded = decodeGateAttributionFile(
      stamped({
        phase: "phase-01",
        steps: [{ command: "pnpm test", surface: "bogus", result: "pass" }],
      }),
    );

    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a step whose result is outside pass | fail | pending", () => {
    const decoded = decodeGateAttributionFile(
      stamped({
        phase: "phase-01",
        steps: [{ command: "pnpm test", surface: "local", result: "skipped" }],
      }),
    );

    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("decodes a pending result", () => {
    const decoded = decodeGateAttributionFile(
      stamped({
        phase: "phase-01",
        steps: [{ command: "pnpm audit:diagnostics", surface: "structural", result: "pending" }],
      }),
    );

    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.steps[0]?.result).toBe("pending");
    }
  });

  it("rejects a missing phase", () => {
    const decoded = decodeGateAttributionFile(stamped({ steps: [] }));

    expect(Either.isLeft(decoded)).toBe(true);
  });
});
