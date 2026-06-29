import { describe, it, expect } from "vitest";
import { Either } from "effect";
import {
  decodeExtractedPlanCacheEntry,
  encodeExtractedPlanCacheEntry,
} from "../../src/schemas/extractedPlanCacheEntry.js";

const VALID_EXTRACTED = {
  version: 1,
  run: {
    shortName: "my-run",
    title: "My Run",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      model: "claude-sonnet-4-6",
      effort: "medium",
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "feat: do thing", body: "Does the thing." },
    },
  ],
} as const;

function makeEntry(overrides?: Record<string, unknown>) {
  return {
    version: 1 as const,
    key: "abc123",
    planMdSha256: "deadbeef",
    model: "claude-sonnet-4-6",
    effort: "medium",
    extractorVersion: 1,
    extractedAt: "2026-01-01T00:00:00.000Z",
    extracted: VALID_EXTRACTED,
    ...overrides,
  };
}

describe("decodeExtractedPlanCacheEntry", () => {
  it("decodes a valid entry", () => {
    const result = decodeExtractedPlanCacheEntry(makeEntry());
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.version).toBe(1);
      expect(result.right.key).toBe("abc123");
      expect(result.right.extracted.run.shortName).toBe("my-run");
    }
  });

  it("fails when version field is missing", () => {
    const { version: _v, ...noVersion } = makeEntry();
    const result = decodeExtractedPlanCacheEntry(noVersion);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails when key field is missing", () => {
    const { key: _k, ...noKey } = makeEntry();
    const result = decodeExtractedPlanCacheEntry(noKey);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails when extracted field is missing", () => {
    const { extracted: _e, ...noExtracted } = makeEntry();
    const result = decodeExtractedPlanCacheEntry(noExtracted);
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails on an unknown extra key", () => {
    const result = decodeExtractedPlanCacheEntry(makeEntry({ unknownField: "oops" }));
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails when extracted.version is wrong", () => {
    const result = decodeExtractedPlanCacheEntry(
      makeEntry({ extracted: { ...VALID_EXTRACTED, version: 99 } }),
    );
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("encodeExtractedPlanCacheEntry", () => {
  it("round-trips a valid entry through decode → encode", () => {
    const decoded = Either.getOrThrow(decodeExtractedPlanCacheEntry(makeEntry()));
    const encoded = encodeExtractedPlanCacheEntry(decoded);
    const re = decodeExtractedPlanCacheEntry(encoded);
    expect(Either.isRight(re)).toBe(true);
  });
});
