import { describe, expect, it } from "vitest";
import { Result } from "effect";
import {
  decodeGateAttributionFile,
  encodeGateAttributionFile,
  type GateAttribution,
} from "../../src/schemas/gateAttribution.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";

const MEASURED = {
  kind: "measured",
  startedAt: "2026-11-23T10:00:00.000Z",
  durationMs: 1200,
} as const;

function stamped<T extends object>(value: T) {
  return withSchemaUrl("gate-attribution", value);
}

describe("GateAttributionFileSchema", () => {
  it("round-trips a record through encode/decode, $schema first", () => {
    const record: GateAttribution = {
      phase: "phase-01",
      time: MEASURED,
      protectedPaths: null,
      steps: [
        { command: "pnpm test", surface: "local", result: "pass", time: MEASURED },
        {
          command: "pnpm audit:architecture",
          surface: "structural",
          result: "fail",
          time: MEASURED,
        },
      ],
    };

    const encoded = encodeGateAttributionFile(stamped(record));
    expect(Object.keys(encoded)[0]).toBe("$schema");
    const decoded = decodeGateAttributionFile(encoded);

    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toEqual(stamped(record));
    }
  });

  it("decodes an empty steps array", () => {
    const decoded = decodeGateAttributionFile(
      stamped({ phase: "phase-01", time: MEASURED, steps: [], protectedPaths: null }),
    );

    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success.steps).toEqual([]);
    }
  });

  it("rejects a document without $schema", () => {
    expect(Result.isFailure(decodeGateAttributionFile({ phase: "phase-01", steps: [] }))).toBe(
      true,
    );
  });

  it("rejects a step whose surface is outside local | structural | product", () => {
    const decoded = decodeGateAttributionFile(
      stamped({
        phase: "phase-01",
        time: MEASURED,
        protectedPaths: null,
        steps: [{ command: "pnpm test", surface: "bogus", result: "pass", time: MEASURED }],
      }),
    );

    expect(Result.isFailure(decoded)).toBe(true);
  });

  it("decodes a step a refused gate report stopped", () => {
    const record: GateAttribution = {
      phase: "phase-01",
      time: MEASURED,
      protectedPaths: null,
      steps: [
        { command: "pnpm test", surface: "local", result: "pass", time: MEASURED },
        { command: "node ./audit.mjs", surface: "structural", result: "refused", time: MEASURED },
      ],
    };

    expect(decodeGateAttributionFile(encodeGateAttributionFile(stamped(record)))).toEqual(
      Result.succeed(stamped(record)),
    );
  });

  it("decodes a step of the oracle surface", () => {
    const record: GateAttribution = {
      phase: "phase-02",
      time: MEASURED,
      protectedPaths: null,
      steps: [
        { command: "pnpm test", surface: "local", result: "pass", time: MEASURED },
        { command: "oracles provider", surface: "acceptance", result: "pass", time: MEASURED },
      ],
    };

    expect(decodeGateAttributionFile(encodeGateAttributionFile(stamped(record)))).toEqual(
      Result.succeed(stamped(record)),
    );
  });

  it("rejects a step whose surface is outside local | structural | product | oracle", () => {
    const decoded = decodeGateAttributionFile(
      stamped({
        phase: "phase-01",
        time: MEASURED,
        protectedPaths: null,
        steps: [{ command: "pnpm test", surface: "unit", result: "pass", time: MEASURED }],
      }),
    );

    expect(Result.isFailure(decoded)).toBe(true);
  });

  it("rejects a configured step whose result is skipped", () => {
    const decoded = decodeGateAttributionFile(
      stamped({
        phase: "phase-01",
        time: MEASURED,
        protectedPaths: null,
        steps: [{ command: "pnpm test", surface: "local", result: "skipped", time: MEASURED }],
      }),
    );

    expect(Result.isFailure(decoded)).toBe(true);
  });

  it("round-trips an oracle step the operator skipped, after a configured step", () => {
    const record: GateAttribution = {
      phase: "phase-03",
      time: MEASURED,
      protectedPaths: null,
      steps: [
        { command: "pnpm test", surface: "local", result: "pass", time: MEASURED },
        {
          command: "oracles provider",
          surface: "acceptance",
          result: "skipped",
          time: { kind: "not-run" },
        },
      ],
    };

    const encoded = encodeGateAttributionFile(stamped(record));

    expect(encoded.$schema).toMatch(/\/gate-attribution\//);
    expect(decodeGateAttributionFile(encoded)).toEqual(Result.succeed(stamped(record)));
  });

  it("rejects a missing phase", () => {
    const decoded = decodeGateAttributionFile(stamped({ steps: [], protectedPaths: null }));

    expect(Result.isFailure(decoded)).toBe(true);
  });
});
