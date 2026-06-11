import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import { resolveModel } from "../../../src/domain/routing/resolve.js";
import type { ModelRouting } from "../../../src/schemas/modelRouting.js";
import type { ProviderConfig } from "../../../src/schemas/providerConfig.js";

const claudeOnly: ModelRouting = {
  ...DEFAULT_MODEL_ROUTING,
  providerPriority: ["claude-code"],
};

const mistralPriority: ModelRouting = {
  ...DEFAULT_MODEL_ROUTING,
  providerPriority: ["mistral-vibe", "codex-cli", "claude-code"],
};

const allEnabledProviderConfig: ProviderConfig = {
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "mistral-vibe": { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true },
    "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!, enabled: true },
  },
};

describe("criterion 8 — claude-sonnet/low never resolves to claude-haiku", () => {
  it("claude-only resolution preserves Sonnet for sonnet/low", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "low" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.normalizedTier).toBe("fast");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.selected.family).not.toBe("claude-haiku");
    expect(result.selected.thinking).toBe("low");
    expect(result.relationship).toBe("exact");
  });

  it("clean-install default preserves Sonnet for sonnet/low", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "low" },
      DEFAULT_MODEL_ROUTING,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.selected.family).not.toBe("claude-haiku");
  });

  it("forces back to Sonnet when a user pins claude-haiku on the fast tier (no explicit downgrade)", () => {
    const userRouting: ModelRouting = {
      ...claudeOnly,
      tiers: {
        ...claudeOnly.tiers,
        fast: { "claude-code": { family: "claude-haiku" } },
      },
    };

    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "low" },
      userRouting,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.selected.thinking).toBe("low");
    expect(result.relationship).toBe("exact");
  });

  it("honours an explicit user-configured cross-Claude downgrade when allowDowngrade=true", () => {
    const userRouting: ModelRouting = {
      ...claudeOnly,
      allowDowngrade: true,
      tiers: {
        ...claudeOnly.tiers,
        fast: { "claude-code": { family: "claude-haiku", relationship: "downgrade" } },
      },
    };

    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "low" },
      userRouting,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-haiku");
    expect(result.relationship).toBe("downgrade");
  });

  it("blocks an explicit cross-Claude downgrade when allowDowngrade=false", () => {
    const userRouting: ModelRouting = {
      ...claudeOnly,
      allowDowngrade: false,
      tiers: {
        ...claudeOnly.tiers,
        fast: { "claude-code": { family: "claude-haiku", relationship: "downgrade" } },
      },
    };

    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "low" },
      userRouting,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.selected.family).not.toBe("claude-haiku");
  });
});

describe("criterion 9 — claude-opus/low never resolves to claude-sonnet without explicit downgrade", () => {
  it("claude-only resolution preserves Opus for opus/low and routes to its own frontier-low tier", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "low" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.normalizedTier).toBe("frontier-low");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.family).not.toBe("claude-sonnet");
    expect(result.selected.thinking).toBe("low");
    expect(result.selected.concreteModel).toBe("claude-opus-4-8");
    expect(result.relationship).toBe("exact");
  });

  it("forces back to Opus when a user pins claude-sonnet on the frontier-low tier (no explicit downgrade)", () => {
    const userRouting: ModelRouting = {
      ...claudeOnly,
      allowDowngrade: true,
      tiers: {
        ...claudeOnly.tiers,
        "frontier-low": { "claude-code": { family: "claude-sonnet", effort: "max" } },
      },
    };

    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "low" },
      userRouting,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.family).not.toBe("claude-sonnet");
    expect(result.selected.thinking).toBe("low");
  });

  it("blocks the cross-Claude downgrade when allowDowngrade=false even if relationship='downgrade'", () => {
    const userRouting: ModelRouting = {
      ...claudeOnly,
      allowDowngrade: false,
      tiers: {
        ...claudeOnly.tiers,
        "frontier-low": {
          "claude-code": { family: "claude-sonnet", effort: "max", relationship: "downgrade" },
        },
      },
    };

    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "low" },
      userRouting,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.family).toBe("claude-opus");
  });

  it("honours an explicit Claude downgrade when allowDowngrade=true and relationship='downgrade'", () => {
    const userRouting: ModelRouting = {
      ...claudeOnly,
      allowDowngrade: true,
      tiers: {
        ...claudeOnly.tiers,
        "frontier-low": {
          "claude-code": { family: "claude-sonnet", effort: "max", relationship: "downgrade" },
        },
      },
    };

    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "low" },
      userRouting,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.relationship).toBe("downgrade");
  });
});

describe("criterion 10 — claude-opus/ultracode has no default equivalent and prefers Claude Opus", () => {
  it("resolves to claude-code/claude-opus/ultracode on the frontier-ultra tier with mistral priority enabled", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      mistralPriority,
      allEnabledProviderConfig,
    );

    expect(result.normalizedTier).toBe("frontier-ultra");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.thinking).toBe("ultracode");
    expect(result.selected.concreteModel).toBe("claude-opus-4-8");
    expect(result.relationship).toBe("exact");
  });

  it("never silently downgrades ultracode to mistral or codex in the default routing", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      mistralPriority,
      allEnabledProviderConfig,
    );

    expect(result.selected.provider).not.toBe("mistral-vibe");
    expect(result.selected.provider).not.toBe("codex-cli");
    expect(result.selected.family).not.toBe("mistral-medium");
    expect(result.selected.family).not.toBe("openai-gpt");
  });

  it("frontier-ultra tier resolves the same way with codex priority", () => {
    const codexPriority: ModelRouting = {
      ...DEFAULT_MODEL_ROUTING,
      providerPriority: ["codex-cli", "claude-code"],
    };

    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      codexPriority,
      allEnabledProviderConfig,
    );

    expect(result.normalizedTier).toBe("frontier-ultra");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.thinking).toBe("ultracode");
  });
});

describe("effort clamping — out-of-set requests for claude-code", () => {
  it("clamps haiku/medium to claude-haiku/none (haiku supports only none)", () => {
    const result = resolveModel(
      { model: "haiku", effort: "medium" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.family).toBe("claude-haiku");
    expect(result.selected.thinking).toBe("none");
    expect(result.relationship).toBe("equivalent");
  });

  it("preserves opus/ultracode when claude-code is selected (ultracode is supported by opus)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.thinking).toBe("ultracode");
    expect(result.relationship).toBe("exact");
  });
});

describe("frontier-ultra tier resolution", () => {
  it("frontier-ultra tier with claude-code only resolves to opus/ultracode", () => {
    const result = resolveModel(
      { model: "opus", effort: "ultracode" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.normalizedTier).toBe("frontier-ultra");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.thinking).toBe("ultracode");
  });

  it("a user-added explicit ultracode downgrade is honoured only when allowDowngrade=true", () => {
    const userRoutingWithMistralUltra: ModelRouting = {
      ...mistralPriority,
      allowDowngrade: true,
      tiers: {
        ...mistralPriority.tiers,
        "frontier-ultra": {
          ...mistralPriority.tiers["frontier-ultra"]!,
          "mistral-vibe": {
            family: "mistral-medium",
            thinking: "max",
            relationship: "downgrade",
          },
        },
      },
    };

    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      userRoutingWithMistralUltra,
      allEnabledProviderConfig,
    );

    expect(result.selected.provider).toBe("mistral-vibe");
    expect(result.relationship).toBe("downgrade");
  });

  it("blocks a user-added ultracode downgrade when allowDowngrade=false", () => {
    const userRoutingBlocked: ModelRouting = {
      ...mistralPriority,
      allowDowngrade: false,
      tiers: {
        ...mistralPriority.tiers,
        "frontier-ultra": {
          ...mistralPriority.tiers["frontier-ultra"]!,
          "mistral-vibe": {
            family: "mistral-medium",
            thinking: "max",
            relationship: "downgrade",
          },
        },
      },
    };

    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      userRoutingBlocked,
      allEnabledProviderConfig,
    );

    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
  });
});
