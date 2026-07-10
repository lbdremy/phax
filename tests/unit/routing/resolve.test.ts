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

const codexPriority: ModelRouting = {
  ...DEFAULT_MODEL_ROUTING,
  providerPriority: ["codex-cli", "claude-code"],
};

const allEnabled: ProviderConfig = {
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "mistral-vibe": { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true },
    "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!, enabled: true },
  },
};

describe("resolveModel — native same-family passthrough", () => {
  it("Claude request on claude-code runs the versioned id directly (exact)", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.requested.family).toBe("claude-sonnet");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.selected.concreteModel).toBe("claude-sonnet-4-6");
    expect(result.selected.thinking).toBe("medium");
    expect(result.relationship).toBe("exact");
  });

  it("Opus request on claude-code preserves the requested effort (exact)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.concreteModel).toBe("claude-opus-4-8");
    expect(result.selected.thinking).toBe("ultracode");
    expect(result.relationship).toBe("exact");
  });

  it("clamps a Sonnet request whose effort is not in the entry's efforts (equivalent)", () => {
    // claude-sonnet-4-6 supports low/medium/high/max but not xhigh; nearest is high.
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "xhigh" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.selected.thinking).toBe("high");
    expect(result.relationship).toBe("equivalent");
  });

  it("clean-install default resolves same-family Claude natively (mistral/codex disabled)", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      DEFAULT_MODEL_ROUTING,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.relationship).toBe("exact");
  });

  it("resolves a spoke id on its own spoke provider natively (exact)", () => {
    const result = resolveModel({ model: "gpt-5.5", effort: "medium" }, codexPriority, allEnabled);
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-gpt");
    expect(result.selected.concreteModel).toBe("gpt-5.5");
    expect(result.selected.thinking).toBe("medium");
    expect(result.relationship).toBe("exact");
  });
});

describe("resolveModel — cross-family translation via the Claude hub", () => {
  it("claude-sonnet/medium translates to codex-cli/gpt-5.5/medium (equivalent)", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      codexPriority,
      allEnabled,
    );
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-gpt");
    expect(result.selected.concreteModel).toBe("gpt-5.5");
    expect(result.selected.thinking).toBe("medium");
    expect(result.relationship).toBe("equivalent");
  });

  it("claude-sonnet/medium with mistral priority selects mistral's medium alias (equivalent)", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralPriority,
      allEnabled,
    );
    expect(result.selected.provider).toBe("mistral-vibe");
    expect(result.selected.family).toBe("mistral-medium");
    expect(result.selected.concreteModel).toBe("phax-mistral-medium-3.5-medium");
    expect(result.selected.thinking).toBe("medium");
    expect(result.relationship).toBe("equivalent");
  });

  it("claude-opus/medium translates to codex-cli/gpt-5.5/xhigh via the hub (equivalent)", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "medium" },
      codexPriority,
      allEnabled,
    );
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-gpt");
    expect(result.selected.concreteModel).toBe("gpt-5.5");
    expect(result.selected.thinking).toBe("xhigh");
    expect(result.relationship).toBe("equivalent");
  });

  it("gpt-5.5/medium translates to claude-code/claude-sonnet-4-6/medium via inverted hub edge", () => {
    // gpt-5.5 medium is anchored to claude-sonnet-4-6/medium (equivalent).
    const result = resolveModel({ model: "gpt-5.5", effort: "medium" }, claudeOnly, allEnabled);
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.selected.concreteModel).toBe("claude-sonnet-4-6");
    expect(result.selected.thinking).toBe("medium");
    // spoke→hub inverts the stored relation; equivalent is self-inverse.
    expect(result.relationship).toBe("equivalent");
  });
});

describe("resolveModel — allowDowngrade floor", () => {
  it("skips a downgrade edge when allowDowngrade=false, falling to claude-code native", () => {
    const routing: ModelRouting = {
      ...DEFAULT_MODEL_ROUTING,
      providerPriority: ["codex-cli", "claude-code"],
      allowDowngrade: false,
      equivalence: {
        ...DEFAULT_MODEL_ROUTING.equivalence,
        "gpt-5.5": {
          ...DEFAULT_MODEL_ROUTING.equivalence["gpt-5.5"]!,
          xhigh: { claude: "claude-opus-4-8", effort: "max", relation: "downgrade" },
        },
      },
    };
    const result = resolveModel({ model: "claude-opus-4-8", effort: "max" }, routing, allEnabled);
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.relationship).toBe("exact");
  });

  it("honours a downgrade edge when allowDowngrade=true", () => {
    const routing: ModelRouting = {
      ...DEFAULT_MODEL_ROUTING,
      providerPriority: ["codex-cli", "claude-code"],
      allowDowngrade: true,
      equivalence: {
        ...DEFAULT_MODEL_ROUTING.equivalence,
        "gpt-5.5": {
          ...DEFAULT_MODEL_ROUTING.equivalence["gpt-5.5"]!,
          xhigh: { claude: "claude-opus-4-8", effort: "max", relation: "downgrade" },
        },
      },
    };
    const result = resolveModel({ model: "claude-opus-4-8", effort: "max" }, routing, allEnabled);
    expect(result.selected.provider).toBe("codex-cli");
    expect(result.selected.family).toBe("openai-gpt");
    expect(result.selected.thinking).toBe("xhigh");
    expect(result.relationship).toBe("downgrade");
  });

  it("skips a no_equivalent edge when allowDowngrade=false", () => {
    // Opus/ultracode has no gpt-5.5 anchor in the default table → codex-cli
    // fails to translate and we fall through to claude-code.
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      { ...codexPriority, allowDowngrade: false },
      allEnabled,
    );
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.thinking).toBe("ultracode");
    expect(result.relationship).toBe("exact");
  });
});

describe("resolveModel — terminal claude-code fallback", () => {
  it("skips a disabled provider even when its family entry exists", () => {
    // mistral-vibe is disabled in DEFAULT_PROVIDER_CONFIG; the walk falls
    // through to claude-code native.
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralPriority,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
    expect(result.relationship).toBe("exact");
  });

  it("falls to claude-code when every non-Claude provider is disabled", () => {
    const result = resolveModel(
      { model: "claude-opus-4-8", effort: "ultracode" },
      mistralPriority,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-opus");
    expect(result.selected.thinking).toBe("ultracode");
    expect(result.relationship).toBe("exact");
  });

  it("routes unknown ids through the substring heuristic to claude-code", () => {
    const result = resolveModel(
      { model: "totally-unknown-model", effort: "medium" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );
    // Unknown id → familyOfId misses, fallback: claude-sonnet.
    expect(result.requested.family).toBe("claude-sonnet");
    expect(result.selected.provider).toBe("claude-code");
    expect(result.selected.family).toBe("claude-sonnet");
  });

  it("preserves selected family when heuristic matches (e.g., unknown opus id)", () => {
    const result = resolveModel(
      { model: "claude-opus-9-9", effort: "high" },
      claudeOnly,
      DEFAULT_PROVIDER_CONFIG,
    );
    expect(result.requested.family).toBe("claude-opus");
    expect(result.selected.family).toBe("claude-opus");
    // Requested id not in catalog → equivalent (substitution).
    expect(result.relationship).toBe("equivalent");
  });
});

describe("resolveModel — reason and skippedForSecurity", () => {
  it("mentions the selected provider and family in the reason", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralPriority,
      allEnabled,
    );
    expect(result.reason).toMatch(/mistral-vibe/);
    expect(result.reason).toMatch(/equivalent/);
  });

  it("omits skippedForSecurity when no securityFilter is supplied", () => {
    const result = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      mistralPriority,
      allEnabled,
    );
    expect(result.skippedForSecurity).toBeUndefined();
    expect(result.reason).not.toMatch(/Skipped for security/);
  });
});
