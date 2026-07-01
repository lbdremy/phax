import { describe, expect, it } from "vitest";
import { FAMILY_EFFORTS, isEffortSupported } from "../../../src/domain/routing/types.js";
import type {
  ClaudeHaikuEffort,
  ClaudeOpusEffort,
  ClaudeSonnetEffort,
  EffortLevel,
  MistralMediumEffort,
  ModelFamily,
  OpenAiGptEffort,
} from "../../../src/domain/routing/types.js";

describe("FAMILY_EFFORTS", () => {
  it("contains exactly the five model families", () => {
    const families = Object.keys(FAMILY_EFFORTS).toSorted();
    expect(families).toEqual(
      (
        ["claude-haiku", "claude-opus", "claude-sonnet", "mistral-medium", "openai-gpt"] as const
      ).toSorted(),
    );
  });

  it("claude-haiku supports only none", () => {
    const expected: readonly ClaudeHaikuEffort[] = ["none"];
    expect(FAMILY_EFFORTS["claude-haiku"]).toEqual(expected);
  });

  it("claude-sonnet supports low|medium|high|xhigh|max", () => {
    const expected: readonly ClaudeSonnetEffort[] = ["low", "medium", "high", "xhigh", "max"];
    expect(FAMILY_EFFORTS["claude-sonnet"]).toEqual(expected);
  });

  it("claude-opus supports low|medium|high|xhigh|max|ultracode", () => {
    const expected: readonly ClaudeOpusEffort[] = [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultracode",
    ];
    expect(FAMILY_EFFORTS["claude-opus"]).toEqual(expected);
  });

  it("mistral-medium supports off|low|medium|high|max", () => {
    const expected: readonly MistralMediumEffort[] = ["off", "low", "medium", "high", "max"];
    expect(FAMILY_EFFORTS["mistral-medium"]).toEqual(expected);
  });

  it("openai-gpt supports low|medium|high|xhigh", () => {
    const expected: readonly OpenAiGptEffort[] = ["low", "medium", "high", "xhigh"];
    expect(FAMILY_EFFORTS["openai-gpt"]).toEqual(expected);
  });

  it("every ModelFamily key is present", () => {
    const families: ModelFamily[] = [
      "claude-haiku",
      "claude-sonnet",
      "claude-opus",
      "mistral-medium",
      "openai-gpt",
    ];
    for (const f of families) {
      expect(FAMILY_EFFORTS[f]).toBeDefined();
      expect(FAMILY_EFFORTS[f].length).toBeGreaterThan(0);
    }
  });

  it("every value in each family list is a valid EffortLevel", () => {
    for (const [, efforts] of Object.entries(FAMILY_EFFORTS)) {
      for (const effort of efforts) {
        const asEffortLevel: EffortLevel = effort;
        expect(typeof asEffortLevel).toBe("string");
      }
    }
  });
});

describe("isEffortSupported", () => {
  it("returns true for supported effort per family", () => {
    expect(isEffortSupported("claude-haiku", "none")).toBe(true);
    expect(isEffortSupported("claude-sonnet", "low")).toBe(true);
    expect(isEffortSupported("claude-sonnet", "medium")).toBe(true);
    expect(isEffortSupported("claude-sonnet", "high")).toBe(true);
    expect(isEffortSupported("claude-sonnet", "xhigh")).toBe(true);
    expect(isEffortSupported("claude-sonnet", "max")).toBe(true);
    expect(isEffortSupported("claude-opus", "ultracode")).toBe(true);
    expect(isEffortSupported("claude-opus", "xhigh")).toBe(true);
    expect(isEffortSupported("mistral-medium", "off")).toBe(true);
    expect(isEffortSupported("mistral-medium", "max")).toBe(true);
    expect(isEffortSupported("openai-gpt", "xhigh")).toBe(true);
    expect(isEffortSupported("openai-gpt", "low")).toBe(true);
  });

  it("returns false for unsupported effort per family", () => {
    expect(isEffortSupported("claude-haiku", "low")).toBe(false);
    expect(isEffortSupported("claude-haiku", "high")).toBe(false);
    expect(isEffortSupported("claude-haiku", "ultracode")).toBe(false);
    expect(isEffortSupported("claude-sonnet", "none")).toBe(false);
    expect(isEffortSupported("claude-sonnet", "ultracode")).toBe(false);
    expect(isEffortSupported("claude-sonnet", "off")).toBe(false);
    expect(isEffortSupported("openai-gpt", "ultracode")).toBe(false);
    expect(isEffortSupported("openai-gpt", "none")).toBe(false);
    expect(isEffortSupported("openai-gpt", "off")).toBe(false);
    expect(isEffortSupported("mistral-medium", "ultracode")).toBe(false);
    expect(isEffortSupported("mistral-medium", "none")).toBe(false);
  });
});
