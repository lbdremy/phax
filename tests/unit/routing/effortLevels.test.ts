import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER_CONFIG } from "../../../src/domain/routing/defaults.js";
import { effortsFor, entryFor } from "../../../src/domain/routing/catalog.js";
import type { ThinkingLevel } from "../../../src/domain/routing/types.js";

// Efforts are declared per catalog entry (per version), not per family. This
// suite pins the default catalog's per-entry effort sets so a regression in
// DEFAULT_PROVIDER_CONFIG surfaces here.

describe("per-entry efforts in DEFAULT_PROVIDER_CONFIG", () => {
  it("claude-haiku-4-5-20251001 supports only none", () => {
    const expected: readonly ThinkingLevel[] = ["none"];
    expect(effortsFor("claude-haiku-4-5-20251001", DEFAULT_PROVIDER_CONFIG)).toEqual(expected);
  });

  it("claude-sonnet-4-6 supports low|medium|high|max", () => {
    const expected: readonly ThinkingLevel[] = ["low", "medium", "high", "max"];
    expect(effortsFor("claude-sonnet-4-6", DEFAULT_PROVIDER_CONFIG)).toEqual(expected);
  });

  it("claude-opus-4-8 supports low|medium|high|xhigh|max|ultracode", () => {
    const expected: readonly ThinkingLevel[] = [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultracode",
    ];
    expect(effortsFor("claude-opus-4-8", DEFAULT_PROVIDER_CONFIG)).toEqual(expected);
  });

  it("gpt-5.5 supports low|medium|high|xhigh", () => {
    const expected: readonly ThinkingLevel[] = ["low", "medium", "high", "xhigh"];
    expect(effortsFor("gpt-5.5", DEFAULT_PROVIDER_CONFIG)).toEqual(expected);
  });

  it("every mistral alias entry advertises exactly one effort", () => {
    const aliases = [
      { id: "phax-mistral-medium-3.5-off", effort: "off" as const },
      { id: "phax-mistral-medium-3.5-low", effort: "low" as const },
      { id: "phax-mistral-medium-3.5-medium", effort: "medium" as const },
      { id: "phax-mistral-medium-3.5-high", effort: "high" as const },
      { id: "phax-mistral-medium-3.5-max", effort: "max" as const },
    ];
    for (const { id, effort } of aliases) {
      const efforts = effortsFor(id, DEFAULT_PROVIDER_CONFIG);
      expect(efforts).toEqual([effort]);
    }
  });

  it("every catalog entry is marked status active", () => {
    const ids = [
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
      "claude-opus-4-8",
      "gpt-5.5",
      "phax-mistral-medium-3.5-off",
      "phax-mistral-medium-3.5-low",
      "phax-mistral-medium-3.5-medium",
      "phax-mistral-medium-3.5-high",
      "phax-mistral-medium-3.5-max",
    ];
    for (const id of ids) {
      const loc = entryFor(id, DEFAULT_PROVIDER_CONFIG);
      expect(loc?.entry.status).toBe("active");
    }
  });
});
