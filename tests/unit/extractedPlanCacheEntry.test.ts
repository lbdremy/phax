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
      mode: "headless",
      oracle: null,
      testLines: [
        {
          guarantee: "the thing is done",
          size: "small",
          technique: "example",
          oracle: "the thing",
          loop: "in-phase",
          criterion: null,
        },
      ],
      commit: { subject: "feat: do thing", body: "Does the thing." },
    },
  ],
} as const;

// The entry's phases as extractor version 3 wrote them: no testLines.
const V3_EXTRACTED = {
  ...VALID_EXTRACTED,
  phases: VALID_EXTRACTED.phases.map(({ testLines: _lines, ...phase }) => phase),
};

// The entry's phases as extractor version 2 wrote them: no mode, no oracle, no testLines.
const V2_EXTRACTED = {
  ...VALID_EXTRACTED,
  phases: V3_EXTRACTED.phases.map(({ mode: _mode, oracle: _oracle, ...phase }) => phase),
};

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

  it("fails on an entry whose phases carry no testLines", () => {
    const result = decodeExtractedPlanCacheEntry(
      makeEntry({ extractorVersion: 3, extracted: V3_EXTRACTED }),
    );
    expect(Either.isLeft(result)).toBe(true);
  });

  it("fails on an entry whose phases carry no mode and no oracle", () => {
    const result = decodeExtractedPlanCacheEntry(
      makeEntry({ extractorVersion: 2, extracted: V2_EXTRACTED }),
    );
    expect(Either.isLeft(result)).toBe(true);
  });

  it("decodes an interactive phase with an oracle", () => {
    const result = decodeExtractedPlanCacheEntry(
      makeEntry({
        extracted: {
          ...VALID_EXTRACTED,
          phases: [
            {
              ...VALID_EXTRACTED.phases[0],
              mode: "interactive",
              oracle: { dischargedBy: "phase-02", files: ["tests/a.test.ts"] },
            },
          ],
        },
      }),
    );
    expect(Either.isRight(result)).toBe(true);
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
