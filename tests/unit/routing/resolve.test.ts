import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import { resolveModel } from "../../../src/domain/routing/resolve.js";
import type { ModelRouting } from "../../../src/schemas/modelRouting.js";
import type { ProviderConfig } from "../../../src/schemas/providerConfig.js";

const mistralPriority: ModelRouting = {
  ...DEFAULT_MODEL_ROUTING,
  providerPriority: ["mistral-vibe", "codex-cli", "claude-code"],
};

const codexPriority: ModelRouting = {
  ...DEFAULT_MODEL_ROUTING,
  providerPriority: ["codex-cli", "claude-code"],
};

const claudeOnly: ModelRouting = {
  ...DEFAULT_MODEL_ROUTING,
  providerPriority: ["claude-code"],
};

// All non-Claude providers enabled, for §15 example tests that demonstrate routing behaviour.
const allEnabledProviderConfig: ProviderConfig = {
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "mistral-vibe": { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true },
    "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!, enabled: true },
  },
};

describe("resolveModel — spec §15 examples", () => {
  it("Example 1: sonnet/medium with mistral priority → mistral-vibe/mistral-medium/medium (equivalent)", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralPriority,
      allEnabledProviderConfig,
    );

    expect(result.requested.family).toBe("claude-sonnet");
    expect(result.requested.effort).toBe("medium");
    expect(result.normalizedTier).toBe("standard");
    expect(result.selected.provider).toBe("mistral-vibe");
    expect(result.selected.family).toBe("mistral-medium");
    expect(result.selected.thinking).toBe("medium");
    expect(result.selected.concreteModel).toBe("phax-mistral-medium-3.5-medium");
    expect(result.relationship).toBe("equivalent");
  });

  it("Example 2: sonnet/high with codex priority → codex-cli/openai-gpt/medium (equivalent)", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "high" },
      codexPriority,
      allEnabledProviderConfig,
    );

    expect(result.normalizedTier).toBe("strong");
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-gpt");
    expect(result.selected.thinking).toBe("medium");
    expect(result.selected.concreteModel).toBe("gpt-5.5");
    expect(result.relationship).toBe("equivalent");
  });

  it("Example 3: opus/medium with mistral priority + allowDowngrade=true → codex-cli/openai-gpt/xhigh (equivalent)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "medium" },
      { ...mistralPriority, allowDowngrade: true },
      allEnabledProviderConfig,
    );

    expect(result.normalizedTier).toBe("frontier-medium");
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-gpt");
    expect(result.selected.thinking).toBe("xhigh");
    expect(result.relationship).toBe("equivalent");
  });

  it("Example 4a: opus/high with mistral priority + allowDowngrade=true → codex-cli (equivalent)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "high" },
      { ...mistralPriority, allowDowngrade: true },
      allEnabledProviderConfig,
    );

    expect(result.normalizedTier).toBe("frontier-high");
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-gpt");
    expect(result.selected.thinking).toBe("xhigh");
    expect(result.relationship).toBe("equivalent");
  });

  it("Example 4b: opus/high with mistral priority + allowDowngrade=false → claude-code/claude-opus (no silent downgrade)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "high" },
      { ...mistralPriority, allowDowngrade: false },
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.normalizedTier).toBe("frontier-high");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.concreteModel).toBe("claude-opus-4-8");
  });

  it("Example 5: opus/max with codex priority + allowDowngrade=true → codex-cli/openai-gpt/xhigh (downgrade)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "max" },
      { ...codexPriority, allowDowngrade: true },
      allEnabledProviderConfig,
    );

    expect(result.normalizedTier).toBe("frontier-max");
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-gpt");
    expect(result.selected.thinking).toBe("xhigh");
    expect(result.relationship).toBe("downgrade");
  });

  it("Example 6: opus/low with codex priority + allowDowngrade=true → codex-cli/openai-gpt/high (equivalent)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "low" },
      { ...codexPriority, allowDowngrade: true },
      allEnabledProviderConfig,
    );

    expect(result.normalizedTier).toBe("frontier-low");
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-gpt");
    expect(result.selected.thinking).toBe("high");
    expect(result.relationship).toBe("equivalent");
  });

  it("Example 7: opus/ultracode has no codex peer; resolves to claude-code/claude-opus/ultracode", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      { ...codexPriority, allowDowngrade: true },
      allEnabledProviderConfig,
    );

    expect(result.normalizedTier).toBe("frontier-ultra");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.thinking).toBe("ultracode");
    expect(result.relationship).toBe("exact");
  });
});

describe("resolveModel — additional behavior", () => {
  it("routes unknown requested model ids to defaultTier with family claude-sonnet", () => {
    const result = resolveModel(
      { model: "totally-unknown-vendor-x1", effort: "high" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.requested.family).toBe("claude-sonnet");
    expect(result.normalizedTier).toBe(DEFAULT_MODEL_ROUTING.defaultTier);
    expect(result.selected.provider).toBe("claude-code");
  });

  it("uses the heuristic when an unconfigured id contains 'sonnet'", () => {
    const result = resolveModel(
      { model: "claude-sonnet-9-9", effort: "medium" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.requested.family).toBe("claude-sonnet");
    expect(result.normalizedTier).toBe("standard");
  });

  it("uses the heuristic for an unconfigured 'gpt' id", () => {
    const result = resolveModel(
      { model: "gpt-6-mini", effort: "medium" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.requested.family).toBe("openai-gpt");
  });

  it("resolves haiku/medium to cheap tier and clamps to claude-haiku/none (equivalent)", () => {
    const result = resolveModel(
      { model: "haiku", effort: "medium" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.normalizedTier).toBe("cheap");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-haiku");
    expect(result.selected.thinking).toBe("none");
    expect(result.selected.concreteModel).toBe("claude-haiku-4-5-20251001");
    expect(result.relationship).toBe("equivalent");
  });

  it("skips a Vibe candidate when the alias is missing in providerCfg", () => {
    const providerCfgNoAlias: ProviderConfig = {
      providers: {
        ...DEFAULT_PROVIDER_CONFIG.providers,
        "mistral-vibe": {
          enabled: true,
          executable: "vibe",
          modelEnvVar: "VIBE_ACTIVE_MODEL",
          defaultAgent: "auto-approve",
          aliases: {
            // intentionally missing mistral-medium/medium
            "mistral-medium/low": "phax-mistral-medium-3.5-low",
          },
        },
      },
    };

    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralPriority,
      providerCfgNoAlias,
    );

    expect(result.selected.provider).not.toBe("mistral-vibe");
  });

  it("skips a disabled provider even when its concrete model exists", () => {
    // mistral-vibe is disabled in DEFAULT_PROVIDER_CONFIG but its alias for
    // mistral-medium/medium is present. The enabled gate must skip it.
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralPriority,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.relationship).toBe("exact");
  });

  it("clean-install default resolves every phase to claude-code", () => {
    // With the §12 default, mistral-vibe and codex-cli are first in providerPriority
    // but ship enabled: false — the enabled gate must skip them so the result is
    // identical to a claude-code-only install.
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      DEFAULT_MODEL_ROUTING,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.relationship).toBe("exact");
  });

  it("classifies a same-family same-effort selection as exact", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.relationship).toBe("exact");
  });

  it("emits a reason string that mentions the selected provider and tier", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralPriority,
      allEnabledProviderConfig,
    );

    expect(result.reason).toMatch(/mistral-vibe/);
    expect(result.reason).toMatch(/standard/);
    expect(result.reason).toMatch(/equivalent/);
  });

  it("each Opus effort routes to its own frontier-* tier with claude-code", () => {
    const cases = [
      { effort: "low", tier: "frontier-low" },
      { effort: "medium", tier: "frontier-medium" },
      { effort: "high", tier: "frontier-high" },
      { effort: "xhigh", tier: "frontier-xhigh" },
      { effort: "max", tier: "frontier-max" },
      { effort: "ultracode", tier: "frontier-ultra" },
    ] as const;

    for (const { effort, tier } of cases) {
      const result = resolveModel(
        { model: "claude-opus-4-8", effort },
        claudeOnly,
        DEFAULT_PROVIDER_CONFIG,
      );

      expect(result.normalizedTier).toBe(tier);
      expect(result.selected.provider).toBe("claude-code");
      expect(result.selected.family).toBe("claude-opus");
      expect(result.selected.thinking).toBe(effort);
      expect(result.selected.concreteModel).toBe("claude-opus-4-8");
      expect(result.relationship).toBe("exact");
    }
  });

  it("resolves sonnet/xhigh to the sonnet-xhigh tier and claude-sonnet-5 (exact)", () => {
    const result = resolveModel(
      { model: "claude-sonnet-5", effort: "xhigh" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.requested.family).toBe("claude-sonnet");
    expect(result.normalizedTier).toBe("sonnet-xhigh");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.selected.thinking).toBe("xhigh");
    expect(result.selected.concreteModel).toBe("claude-sonnet-5");
    expect(result.relationship).toBe("exact");
  });

  it("resolves the legacy claude-sonnet-4-6 alias to the claude-sonnet-5 concrete model", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.requested.family).toBe("claude-sonnet");
    expect(result.selected.concreteModel).toBe("claude-sonnet-5");
  });

  it("omits skippedForSecurity when no securityFilter is supplied", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralPriority,
      allEnabledProviderConfig,
    );

    expect(result.skippedForSecurity).toBeUndefined();
    expect(result.reason).not.toMatch(/Skipped for security/);
  });
});
