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

const allEnabled: ProviderConfig = {
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "mistral-vibe": { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true },
    "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!, enabled: true },
  },
};

describe("same-family passthrough preserves Sonnet for sonnet requests", () => {
  it("claude-only resolution keeps Sonnet for sonnet/low", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "low" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.selected.family).not.toBe("claude-haiku");
    expect(result.selected.thinking).toBe("low");
    expect(result.relationship).toBe("exact");
  });

  it("clean-install default keeps Sonnet for sonnet/low even with mistral+codex first", () => {
    // Both non-Claude providers are disabled by default; the walk falls
    // through to claude-code native.
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "low" },
      DEFAULT_MODEL_ROUTING,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.selected.family).not.toBe("claude-haiku");
  });
});

describe("same-family passthrough preserves Opus for opus requests", () => {
  it("claude-only resolution keeps Opus for opus/low", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "low" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.family).not.toBe("claude-sonnet");
    expect(result.selected.thinking).toBe("low");
    expect(result.selected.concreteModel).toBe("claude-opus-4-8");
    expect(result.relationship).toBe("exact");
  });

  it("every Opus effort resolves natively on claude-code (exact)", () => {
    const efforts = ["low", "medium", "high", "xhigh", "max", "ultracode"] as const;
    for (const effort of efforts) {
      const result = resolveModel(
        { model: "claude-opus-4-8", effort },
        claudeOnly,
        DEFAULT_PROVIDER_CONFIG,
      );
      expect(result.selected.family).toBe("claude-opus");
      expect(result.selected.thinking).toBe(effort);
      expect(result.selected.concreteModel).toBe("claude-opus-4-8");
      expect(result.relationship).toBe("exact");
    }
  });
});

describe("opus/ultracode has no default spoke equivalent", () => {
  it("resolves to claude-code/claude-opus/ultracode with mistral priority enabled", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      mistralPriority,
      allEnabled,
    );
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.thinking).toBe("ultracode");
    expect(result.selected.concreteModel).toBe("claude-opus-4-8");
    expect(result.relationship).toBe("exact");
  });

  it("never silently downgrades ultracode to a non-Claude provider in the default routing", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      mistralPriority,
      allEnabled,
    );
    expect(result.selected.provider).not.toBe("mistral-vibe");
    expect(result.selected.provider).not.toBe("codex-cli");
    expect(result.selected.family).not.toBe("mistral-medium");
    expect(result.selected.family).not.toBe("openai-gpt");
  });
});
