import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { decodeOrientBrief, encodeOrientBrief } from "../../src/schemas/orientBrief.js";

const validRow = {
  id: "row-1",
  title: "Watch out for X",
  severity: "warn",
  trigger: "touches src/foo.ts",
};

describe("decodeOrientBrief", () => {
  it("round-trips the ok variant", () => {
    const ok = {
      kind: "ok" as const,
      files: ["src/foo.ts", "src/bar.ts"],
      rows: [validRow],
      rowCount: 1,
      wovenRowCount: 1,
    };
    const result = decodeOrientBrief(ok);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(encodeOrientBrief(result.right)).toEqual(ok);
    }
  });

  it("round-trips the failed variant", () => {
    const failed = {
      kind: "failed" as const,
      files: ["src/foo.ts"],
      error: "Orient provider exited with code 1",
    };
    const result = decodeOrientBrief(failed);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(encodeOrientBrief(result.right)).toEqual(failed);
    }
  });

  it("round-trips the not-configured variant", () => {
    const notConfigured = { kind: "not-configured" as const };
    const result = decodeOrientBrief(notConfigured);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(encodeOrientBrief(result.right)).toEqual(notConfigured);
    }
  });

  it("rejects a kind outside the three variants", () => {
    const result = decodeOrientBrief({ kind: "unknown" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an ok record missing rowCount", () => {
    const { rowCount: _rowCount, ...withoutRowCount } = {
      kind: "ok" as const,
      files: [],
      rows: [],
      rowCount: 0,
      wovenRowCount: 0,
    };
    const result = decodeOrientBrief(withoutRowCount);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a failed record missing the error message", () => {
    const result = decodeOrientBrief({ kind: "failed", files: ["src/foo.ts"] });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a not-configured record carrying extra ok-only fields", () => {
    const result = decodeOrientBrief({ kind: "not-configured", files: [] });
    expect(Either.isLeft(result)).toBe(true);
  });
});
