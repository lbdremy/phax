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

  it("EXTRACTOR_VERSION is 2", () => {
    expect(EXTRACTOR_VERSION).toBe(2);
  });

  describe("keys on the body without its frontmatter", () => {
    const body = "\n# Plan\n\n## Required commands\n\n- (none)\n";
    const draft = `---\nstatus: Draft\nsource-spec: null\n---\n${body}`;
    const approved = `---\nstatus: Approved\nsource-spec: null\napproved:\n  date: 2026-09-23\n  baseline: abc1234\n---\n${body}`;

    it("same body under two different frontmatter blocks → same key", () => {
      expect(planCacheKey(draft, "claude-sonnet-4-6", "medium")).toBe(
        planCacheKey(approved, "claude-sonnet-4-6", "medium"),
      );
    });

    it("a frontmatter-bearing plan keys like its bare body", () => {
      expect(planCacheKey(draft, "claude-sonnet-4-6", "medium")).toBe(
        planCacheKey(body, "claude-sonnet-4-6", "medium"),
      );
    });

    it("a body edit under the same frontmatter → different key", () => {
      const edited = draft.replace("# Plan", "# Plan, edited");
      expect(planCacheKey(edited, "claude-sonnet-4-6", "medium")).not.toBe(
        planCacheKey(draft, "claude-sonnet-4-6", "medium"),
      );
    });

    it("a plan without a frontmatter block keys on its full text", () => {
      // An unterminated block is not frontmatter: the whole text is the body.
      const unterminated = "---\nstatus: Draft\n# Plan\n";
      expect(planCacheKey(unterminated, "claude-sonnet-4-6", "medium")).not.toBe(
        planCacheKey("# Plan\n", "claude-sonnet-4-6", "medium"),
      );
      expect(planCacheKey("# Plan A", "claude-sonnet-4-6", "medium")).not.toBe(
        planCacheKey("# Plan B", "claude-sonnet-4-6", "medium"),
      );
    });
  });
});
