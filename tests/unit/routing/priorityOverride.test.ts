import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ROUTING } from "../../../src/domain/routing/defaults.js";
import {
  applyProviderPriorityOverride,
  parseProviderPriority,
} from "../../../src/domain/routing/priorityOverride.js";

describe("parseProviderPriority", () => {
  it("parses a single id", () => {
    const result = parseProviderPriority("claude-code");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["claude-code"]);
    }
  });

  it("parses multiple ids", () => {
    const result = parseProviderPriority("mistral-vibe,claude-code");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["mistral-vibe", "claude-code"]);
    }
  });

  it("parses all three ids", () => {
    const result = parseProviderPriority("claude-code,mistral-vibe,codex-cli");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["claude-code", "mistral-vibe", "codex-cli"]);
    }
  });

  it("trims whitespace around tokens", () => {
    const result = parseProviderPriority(" mistral-vibe , claude-code ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["mistral-vibe", "claude-code"]);
    }
  });

  it("drops trailing/empty tokens from trailing comma", () => {
    const result = parseProviderPriority("claude-code,");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["claude-code"]);
    }
  });

  it("deduplicates while preserving first-seen order", () => {
    const result = parseProviderPriority("claude-code,mistral-vibe,claude-code");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["claude-code", "mistral-vibe"]);
    }
  });

  it("returns failure with a message naming the unknown token", () => {
    const result = parseProviderPriority("gpt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('"gpt"');
      expect(result.error).toContain("--provider-priority");
      expect(result.error).toContain("claude-code");
      expect(result.error).toContain("mistral-vibe");
      expect(result.error).toContain("codex-cli");
    }
  });

  it("returns failure for empty input", () => {
    const result = parseProviderPriority("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("--provider-priority must list at least one provider id");
    }
  });

  it("returns failure for whitespace-only input", () => {
    const result = parseProviderPriority("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("--provider-priority must list at least one provider id");
    }
  });
});

describe("applyProviderPriorityOverride", () => {
  it("replaces providerPriority and leaves all other fields untouched", () => {
    const override = ["mistral-vibe", "claude-code"] as const;
    const result = applyProviderPriorityOverride(DEFAULT_MODEL_ROUTING, override);

    expect(result.providerPriority).toEqual(["mistral-vibe", "claude-code"]);

    const { providerPriority: _new, ...restResult } = result;
    const { providerPriority: _orig, ...restOrig } = DEFAULT_MODEL_ROUTING;
    expect(restResult).toEqual(restOrig);
  });

  it("does not mutate the input routing object", () => {
    const override = ["codex-cli"] as const;
    const originalPriority = [...DEFAULT_MODEL_ROUTING.providerPriority];

    applyProviderPriorityOverride(DEFAULT_MODEL_ROUTING, override);

    expect(DEFAULT_MODEL_ROUTING.providerPriority).toEqual(originalPriority);
  });
});
