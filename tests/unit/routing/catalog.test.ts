import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import {
  effortsFor,
  entryFor,
  equivalentFor,
  familyOfId,
  isClaudeFamily,
  isDeprecated,
  nearestEfforts,
} from "../../../src/domain/routing/catalog.js";
import type { ProviderConfig } from "../../../src/schemas/providerConfig.js";
import type { ModelRouting } from "../../../src/schemas/modelRouting.js";

const providerCfgWithDeprecated: ProviderConfig = {
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "claude-code": {
      ...DEFAULT_PROVIDER_CONFIG.providers["claude-code"]!,
      families: {
        ...DEFAULT_PROVIDER_CONFIG.providers["claude-code"]!.families,
        "claude-opus": {
          models: [
            {
              id: "claude-opus-4-8",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"],
              status: "active",
            },
            {
              id: "claude-opus-4-7",
              efforts: ["low", "medium", "high", "xhigh", "max"],
              status: "deprecated",
            },
          ],
        },
      },
    },
  },
};

describe("familyOfId", () => {
  it("returns the family for a Claude id in the catalog", () => {
    expect(familyOfId("claude-sonnet-4-6", DEFAULT_PROVIDER_CONFIG)).toBe("claude-sonnet");
    expect(familyOfId("claude-opus-4-8", DEFAULT_PROVIDER_CONFIG)).toBe("claude-opus");
    expect(familyOfId("claude-haiku-4-5-20251001", DEFAULT_PROVIDER_CONFIG)).toBe("claude-haiku");
  });

  it("returns the family for a spoke id", () => {
    expect(familyOfId("gpt-5.5", DEFAULT_PROVIDER_CONFIG)).toBe("openai-gpt");
    expect(familyOfId("phax-mistral-medium-3.5-medium", DEFAULT_PROVIDER_CONFIG)).toBe(
      "mistral-medium",
    );
  });

  it("returns undefined for an id not in the catalog", () => {
    expect(familyOfId("does-not-exist", DEFAULT_PROVIDER_CONFIG)).toBeUndefined();
  });

  it("finds a coexisting deprecated version alongside its active peer", () => {
    expect(familyOfId("claude-opus-4-7", providerCfgWithDeprecated)).toBe("claude-opus");
  });
});

describe("entryFor", () => {
  it("returns the provider, family, and entry for an id", () => {
    const loc = entryFor("gpt-5.5", DEFAULT_PROVIDER_CONFIG);
    expect(loc?.provider).toBe("codex-cli");
    expect(loc?.family).toBe("openai-gpt");
    expect(loc?.entry.id).toBe("gpt-5.5");
  });

  it("returns undefined for an id not in the catalog", () => {
    expect(entryFor("nope", DEFAULT_PROVIDER_CONFIG)).toBeUndefined();
  });
});

describe("effortsFor", () => {
  it("returns per-entry efforts (not per family)", () => {
    expect(effortsFor("claude-opus-4-8", DEFAULT_PROVIDER_CONFIG)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultracode",
    ]);
    expect(effortsFor("claude-sonnet-4-6", DEFAULT_PROVIDER_CONFIG)).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(effortsFor("gpt-5.5", DEFAULT_PROVIDER_CONFIG)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("distinguishes efforts across coexisting versions of one family", () => {
    // 4-7 lost ultracode support; 4-8 has it. Efforts are per entry.
    expect(effortsFor("claude-opus-4-8", providerCfgWithDeprecated)).toContain("ultracode");
    expect(effortsFor("claude-opus-4-7", providerCfgWithDeprecated)).not.toContain("ultracode");
  });

  it("returns undefined for an unknown id", () => {
    expect(effortsFor("nope", DEFAULT_PROVIDER_CONFIG)).toBeUndefined();
  });
});

describe("isDeprecated", () => {
  it("returns false for an active entry", () => {
    expect(isDeprecated("claude-opus-4-8", providerCfgWithDeprecated)).toBe(false);
  });

  it("returns true for a deprecated entry", () => {
    expect(isDeprecated("claude-opus-4-7", providerCfgWithDeprecated)).toBe(true);
  });

  it("returns false for an unknown id (missing is not deprecated)", () => {
    expect(isDeprecated("nope", DEFAULT_PROVIDER_CONFIG)).toBe(false);
  });
});

describe("nearestEfforts", () => {
  it("returns the exact effort first when supported", () => {
    const near = nearestEfforts("claude-sonnet-4-6", "medium", DEFAULT_PROVIDER_CONFIG);
    expect(near[0]).toBe("medium");
  });

  it("orders by ordinal distance to the requested effort", () => {
    // claude-sonnet-4-6 lacks xhigh; nearest is high, then max.
    const near = nearestEfforts("claude-sonnet-4-6", "xhigh", DEFAULT_PROVIDER_CONFIG);
    expect(near[0]).toBe("high");
    expect(near[1]).toBe("max");
  });

  it("returns [] for an unknown id", () => {
    expect(nearestEfforts("nope", "medium", DEFAULT_PROVIDER_CONFIG)).toEqual([]);
  });
});

describe("isClaudeFamily", () => {
  it("recognizes all three Claude families", () => {
    expect(isClaudeFamily("claude-haiku")).toBe(true);
    expect(isClaudeFamily("claude-sonnet")).toBe(true);
    expect(isClaudeFamily("claude-opus")).toBe(true);
  });

  it("returns false for non-Claude families", () => {
    expect(isClaudeFamily("mistral-medium")).toBe(false);
    expect(isClaudeFamily("openai-gpt")).toBe(false);
  });
});

describe("equivalentFor (star lookup)", () => {
  const routing = DEFAULT_MODEL_ROUTING;

  it("hub → spoke: Claude id + effort finds the anchored spoke entry with stored relation", () => {
    // gpt-5.5/medium is anchored to claude-sonnet-4-6/medium (equivalent).
    const sub = equivalentFor(
      "claude-sonnet-4-6",
      "medium",
      "openai-gpt",
      routing,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(sub?.id).toBe("gpt-5.5");
    expect(sub?.effort).toBe("medium");
    expect(sub?.relation).toBe("equivalent");
  });

  it("hub → spoke: falls back to undefined when no anchor matches", () => {
    // Opus/ultracode is not anchored by any codex entry in the default table.
    const sub = equivalentFor(
      "claude-opus-4-8",
      "ultracode",
      "openai-gpt",
      routing,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(sub).toBeUndefined();
  });

  it("hub → spoke: distinguishes target families (mistral vs openai-gpt)", () => {
    const mistralSub = equivalentFor(
      "claude-sonnet-4-6",
      "medium",
      "mistral-medium",
      routing,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(mistralSub?.id).toBe("phax-mistral-medium-3.5-medium");
    expect(mistralSub?.effort).toBe("medium");
    expect(mistralSub?.relation).toBe("equivalent");

    const codexSub = equivalentFor(
      "claude-sonnet-4-6",
      "medium",
      "openai-gpt",
      routing,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(codexSub?.id).toBe("gpt-5.5");
  });

  it("spoke → hub: direct lookup with inverted relation (equivalent is self-inverse)", () => {
    const sub = equivalentFor(
      "gpt-5.5",
      "medium",
      "claude-sonnet",
      routing,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(sub?.id).toBe("claude-sonnet-4-6");
    expect(sub?.effort).toBe("medium");
    expect(sub?.relation).toBe("equivalent");
  });

  it("spoke → hub: inverts downgrade to upgrade", () => {
    const customRouting: ModelRouting = {
      ...routing,
      equivalence: {
        "gpt-5.5": {
          xhigh: { claude: "claude-opus-4-8", effort: "max", relation: "downgrade" },
        },
      },
    };
    const sub = equivalentFor(
      "gpt-5.5",
      "xhigh",
      "claude-opus",
      customRouting,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(sub?.id).toBe("claude-opus-4-8");
    expect(sub?.effort).toBe("max");
    expect(sub?.relation).toBe("upgrade");
  });

  it("spoke → spoke: routes through the Claude hub and composes relations", () => {
    // gpt-5.5/medium → sonnet/medium (equivalent inverted = equivalent),
    // sonnet/medium → mistral-medium/medium (equivalent).
    // Compose: equivalent + equivalent = equivalent.
    const sub = equivalentFor(
      "gpt-5.5",
      "medium",
      "mistral-medium",
      routing,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(sub?.id).toBe("phax-mistral-medium-3.5-medium");
    expect(sub?.effort).toBe("medium");
    expect(sub?.relation).toBe("equivalent");
  });

  it("returns undefined when source id is not in the catalog", () => {
    const sub = equivalentFor(
      "unknown-id",
      "medium",
      "openai-gpt",
      routing,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(sub).toBeUndefined();
  });

  it("returns undefined when source and target families are the same (native, no translation)", () => {
    const sub = equivalentFor(
      "claude-sonnet-4-6",
      "medium",
      "claude-sonnet",
      routing,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(sub).toBeUndefined();
  });
});
