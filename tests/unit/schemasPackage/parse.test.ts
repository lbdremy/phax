import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { parsePhaseRecordManifest, parseRunStatus } from "../../../packages/schemas/src/index.js";
import { fromEither } from "../../../packages/schemas/src/parsed.js";

const manifest = {
  version: 2,
  runId: "schemas-package-1786807559589",
  phaseId: "phase-01",
  shape: "full",
  sourceSha: "5f4ba697",
  model: "claude-opus-5-5",
  effort: "high",
  provider: "claude-code",
  outcome: "committed",
  usage: {
    available: true,
    usage: {
      provider: "claude-code",
      inputTokens: 41203,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 512,
      outputTokens: 8117,
      totalCostUsd: 0.42,
    },
  },
  verifiedSurfaces: ["local", "structural"],
};

describe("parsePhaseRecordManifest", () => {
  it("returns ok with the shape and the value for a valid manifest", () => {
    expect(parsePhaseRecordManifest(manifest)).toEqual({ ok: true, shape: "v2", value: manifest });
  });

  it("fails at outcome for a paused manifest", () => {
    const result = parsePhaseRecordManifest({ ...manifest, outcome: "paused" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("outcome");
    expect(result.error.message).not.toBe("");
  });

  it("fails with the dotted path for a wrong usage provider", () => {
    const result = parsePhaseRecordManifest({
      ...manifest,
      usage: { available: true, usage: { ...manifest.usage.usage, provider: "gpt" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("usage.usage.provider");
  });

  it.each([42, "record.json", null, undefined, [manifest]])("fails at the root for %j", (input) => {
    const result = parsePhaseRecordManifest(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("");
    expect(result.error.message).not.toBe("");
  });

  it("never throws", () => {
    const inputs: unknown[] = [
      Symbol("x"),
      () => manifest,
      new Map(),
      Object.create(null),
      { ...manifest, usage: null },
      { ...manifest, verifiedSurfaces: "local" },
    ];
    for (const input of inputs) {
      expect(() => parsePhaseRecordManifest(input)).not.toThrow();
    }
  });
});

describe("parseRunStatus", () => {
  const runStatus = {
    version: 1,
    namespace: "phax",
    shortName: "schemas-package",
    runId: "schemas-package-1790152173930",
    state: "running",
    createdAt: "2026-09-29T08:29:33.944Z",
    updatedAt: "2026-09-29T08:42:06.887Z",
    phasesCount: 5,
    gateProfileId: "standard",
  };

  it("returns ok with the shape and the value for a valid run status", () => {
    expect(parseRunStatus(runStatus)).toEqual({ ok: true, shape: "v1", value: runStatus });
  });

  it("fails at state for a paused run status, without throwing", () => {
    const paused = { ...runStatus, state: "paused" };
    expect(() => parseRunStatus(paused)).not.toThrow();
    const result = parseRunStatus(paused);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("state");
    expect(result.error.message).not.toBe("");
  });
});

describe("fromEither", () => {
  const decode = Schema.decodeUnknownEither(
    Schema.Struct({ a: Schema.Struct({ b: Schema.Number }) }),
  );

  it("maps a right to ok", () => {
    expect(fromEither(Either.right(1) as Either.Either<number, never>)).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("maps a left to its first issue's dotted path and message", () => {
    expect(fromEither(decode({ a: { b: "x" } }))).toEqual({
      ok: false,
      error: { path: "a.b", message: 'Expected number, actual "x"' },
    });
  });

  it("reports an array index as a path segment", () => {
    const decodeList = Schema.decodeUnknownEither(
      Schema.Struct({ xs: Schema.Array(Schema.Number) }),
    );
    const result = fromEither(decodeList({ xs: [1, "two"] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("xs.1");
  });
});
