import { describe, it, expect } from "vitest";
import { planCacheKey, EXTRACTOR_VERSION } from "../../src/domain/planCache/key.js";

describe("planCacheKey", () => {
  it("returns a 64-character hex string", () => {
    const key = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same inputs", () => {
    const a = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    const b = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    expect(a).toBe(b);
  });

  it("changes when planMd changes", () => {
    const a = planCacheKey("# Plan A", "claude-sonnet-4-6", "medium");
    const b = planCacheKey("# Plan B", "claude-sonnet-4-6", "medium");
    expect(a).not.toBe(b);
  });

  it("changes when model changes", () => {
    const a = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    const b = planCacheKey("# Plan", "claude-haiku-4-5-20251001", "medium");
    expect(a).not.toBe(b);
  });

  it("changes when effort changes", () => {
    const a = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    const b = planCacheKey("# Plan", "claude-sonnet-4-6", "high");
    expect(a).not.toBe(b);
  });

  it("changes when extractorVersion changes", () => {
    const a = planCacheKey("# Plan", "claude-sonnet-4-6", "medium", 1);
    const b = planCacheKey("# Plan", "claude-sonnet-4-6", "medium", 2);
    expect(a).not.toBe(b);
  });

  it("defaults to EXTRACTOR_VERSION", () => {
    const a = planCacheKey("# Plan", "claude-sonnet-4-6", "medium");
    const b = planCacheKey("# Plan", "claude-sonnet-4-6", "medium", EXTRACTOR_VERSION);
    expect(a).toBe(b);
  });

  it("EXTRACTOR_VERSION is 1", () => {
    expect(EXTRACTOR_VERSION).toBe(1);
  });
});
