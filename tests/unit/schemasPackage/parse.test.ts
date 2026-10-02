import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES } from "../../../packages/schemas/src/generated/index.js";
import { parsePhaseRecordManifest, parseRunStatus } from "../../../packages/schemas/src/index.js";
import { fromEither } from "../../../packages/schemas/src/parsed.js";
import { validDocuments, withKey, type Doc } from "./documents.js";

const manifest = validDocuments["phase-record-manifest"];
const manifestUsage = (manifest["usage"] as { readonly usage: Doc }).usage;

describe("parsePhaseRecordManifest", () => {
  it("returns ok with the shape and the value for a valid manifest", () => {
    expect(parsePhaseRecordManifest(manifest)).toEqual({
      ok: true,
      shape: CURRENT_SHAPES["phase-record-manifest"],
      value: manifest,
    });
  });

  it("fails at outcome for a paused manifest", () => {
    const result = parsePhaseRecordManifest(withKey(manifest, "outcome", "paused"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("outcome");
    expect(result.error.message).not.toBe("");
  });

  it("fails with the dotted path for a wrong usage provider", () => {
    const result = parsePhaseRecordManifest(
      withKey(manifest, "usage", { available: true, usage: { ...manifestUsage, provider: "gpt" } }),
    );
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
      withKey(manifest, "usage", null),
      withKey(manifest, "verifiedSurfaces", "local"),
    ];
    for (const input of inputs) {
      expect(() => parsePhaseRecordManifest(input)).not.toThrow();
    }
  });
});

describe("parseRunStatus", () => {
  const runStatus = validDocuments["run-status"];

  it("returns ok with the shape and the value for a valid run status", () => {
    expect(parseRunStatus(runStatus)).toEqual({
      ok: true,
      shape: CURRENT_SHAPES["run-status"],
      value: runStatus,
    });
  });

  it("fails at state for a paused run status, without throwing", () => {
    const paused = withKey(runStatus, "state", "paused");
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
