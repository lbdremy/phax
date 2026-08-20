import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeRunRecordManifest,
  encodeRunRecordManifest,
  TokenUsageSchema,
  UNAVAILABLE_TOKEN_USAGE,
} from "../../src/schemas/runRecord.js";

const decodeTokenUsage = Schema.decodeUnknownEither(TokenUsageSchema, {
  onExcessProperty: "error",
});

const baseManifest = {
  version: 1 as const,
  runId: "entire-checkpoint-spike-1786807559589",
  phaseId: "phase-01",
  shape: "skeleton" as const,
  model: "claude-sonnet-5",
  effort: "high",
  provider: "claude-code" as const,
  outcome: "committed" as const,
  usage: UNAVAILABLE_TOKEN_USAGE,
};

describe("TokenUsageSchema", () => {
  it("decodes the unavailable variant", () => {
    expect(Either.isRight(decodeTokenUsage({ available: false }))).toBe(true);
  });

  it("decodes an available Claude usage", () => {
    const result = decodeTokenUsage({
      available: true,
      usage: {
        provider: "claude-code",
        inputTokens: 41203,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 512,
        outputTokens: 8117,
        totalCostUsd: 0.42,
      },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("decodes an available codex usage", () => {
    const result = decodeTokenUsage({
      available: true,
      usage: {
        provider: "codex-cli",
        inputTokens: 31299,
        cachedInputTokens: 2432,
        outputTokens: 5,
        reasoningOutputTokens: 0,
      },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("decodes an available vibe usage", () => {
    const result = decodeTokenUsage({
      available: true,
      usage: {
        provider: "mistral-vibe",
        inputTokens: 1000,
        outputTokens: 200,
        sessionCostUsd: 0.05,
        toolCallsAgreed: 3,
        toolCallsRejected: 0,
        toolCallsFailed: 0,
        toolCallsSucceeded: 3,
      },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects an available usage reported as a bare number (never zero-as-unavailable)", () => {
    // A record must never encode "usage: 0" for an unavailable value — the
    // shape forces either the unavailable variant or a full provider object.
    expect(Either.isLeft(decodeTokenUsage(0))).toBe(true);
    expect(Either.isLeft(decodeTokenUsage({ available: true, usage: 0 }))).toBe(true);
  });

  it("rejects a struct mixing available: true with no usage payload", () => {
    expect(Either.isLeft(decodeTokenUsage({ available: true }))).toBe(true);
  });
});

describe("RunRecordManifestSchema", () => {
  it("decodes a minimal skeleton manifest with unavailable usage", () => {
    const result = decodeRunRecordManifest(baseManifest);
    expect(Either.isRight(result)).toBe(true);
  });

  it("decodes a full manifest with a source sha and available usage", () => {
    const result = decodeRunRecordManifest({
      ...baseManifest,
      shape: "full",
      sourceSha: "a726aff",
      usage: {
        available: true,
        usage: {
          provider: "claude-code",
          inputTokens: 41203,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 8117,
          totalCostUsd: 0.12,
        },
      },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("decodes a manifest for a phase that never committed (no sourceSha)", () => {
    const result = decodeRunRecordManifest({ ...baseManifest, outcome: "failed" });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.sourceSha).toBeUndefined();
    }
  });

  it("rejects an unknown outcome", () => {
    const result = decodeRunRecordManifest({ ...baseManifest, outcome: "bogus" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an unknown shape", () => {
    const result = decodeRunRecordManifest({ ...baseManifest, shape: "partial" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = decodeRunRecordManifest({ ...baseManifest, bogus: "value" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("round-trips through encode/decode", () => {
    const encoded = encodeRunRecordManifest(baseManifest);
    const decoded = decodeRunRecordManifest(encoded);
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right).toEqual(baseManifest);
    }
  });
});
