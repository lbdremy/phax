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

describe("resolveModel — spec §15 examples", () => {
  it("Example 1: sonnet/medium with mistral priority → mistral-vibe/mistral-medium/medium (equivalent)", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralPriority,
      DEFAULT_PROVIDER_CONFIG,
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

  it("Example 2: sonnet/high with codex priority → codex-cli/openai-chatgpt/medium (equivalent)", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "high" },
      codexPriority,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.normalizedTier).toBe("strong");
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-chatgpt");
    expect(result.selected.thinking).toBe("medium");
    expect(result.selected.concreteModel).toBe("gpt-5.5");
    expect(result.relationship).toBe("equivalent");
  });

  it("Example 3: opus/medium with mistral priority + allowDowngrade=true → codex-cli/openai-chatgpt/xhigh (fallback)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-7", effort: "medium" },
      { ...mistralPriority, allowDowngrade: true },
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.normalizedTier).toBe("frontier");
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-chatgpt");
    expect(result.selected.thinking).toBe("xhigh");
    expect(result.relationship).toBe("fallback");
  });

  it("Example 4a: opus/high with mistral priority + allowDowngrade=true → codex-cli (downgrade)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-7", effort: "high" },
      { ...mistralPriority, allowDowngrade: true },
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.normalizedTier).toBe("max");
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-chatgpt");
    expect(result.selected.thinking).toBe("max");
    expect(result.relationship).toBe("downgrade");
  });

  it("Example 4b: opus/high with mistral priority + allowDowngrade=false → claude-code/claude-opus (no silent downgrade)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-7", effort: "high" },
      { ...mistralPriority, allowDowngrade: false },
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.normalizedTier).toBe("max");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.concreteModel).toBe("claude-opus-4-7");
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

    expect(result.requested.family).toBe("openai-chatgpt");
  });

  it("resolves haiku/medium to cheap tier and claude-code/claude-haiku exactly", () => {
    const result = resolveModel(
      { model: "haiku", effort: "medium" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.normalizedTier).toBe("cheap");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-haiku");
    expect(result.selected.concreteModel).toBe("claude-haiku-4-5-20251001");
    expect(result.relationship).toBe("exact");
  });

  it("skips a Vibe candidate when the alias is missing in providerCfg", () => {
    const providerCfgNoAlias: ProviderConfig = {
      providers: {
        ...DEFAULT_PROVIDER_CONFIG.providers,
        "mistral-vibe": {
          enabled: false,
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
      DEFAULT_PROVIDER_CONFIG,
    );

    expect(result.reason).toMatch(/mistral-vibe/);
    expect(result.reason).toMatch(/standard/);
    expect(result.reason).toMatch(/equivalent/);
  });
});
