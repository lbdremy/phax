import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";

export const DEFAULT_MODEL_ROUTING: ModelRouting = {
  version: 1,
  providerPriority: ["mistral-vibe", "codex-cli", "claude-code"],
  allowDowngrade: true,
  defaultTier: "standard",
  families: {
    claude: ["claude-haiku", "claude-sonnet", "claude-opus"],
    mistral: ["mistral-medium"],
    openai: ["openai-gpt"],
  },
  tiers: {
    cheap: {
      "claude-code": { family: "claude-haiku" },
      "mistral-vibe": { family: "mistral-medium", thinking: "off" },
      "codex-cli": { family: "openai-gpt", thinking: "low" },
    },
    fast: {
      "claude-code": { family: "claude-sonnet", effort: "low" },
      "mistral-vibe": { family: "mistral-medium", thinking: "low" },
      "codex-cli": { family: "openai-gpt", thinking: "low" },
    },
    standard: {
      "claude-code": { family: "claude-sonnet", effort: "medium" },
      "mistral-vibe": { family: "mistral-medium", thinking: "medium" },
      "codex-cli": { family: "openai-gpt", thinking: "medium" },
    },
    strong: {
      "claude-code": { family: "claude-sonnet", effort: "high" },
      "mistral-vibe": { family: "mistral-medium", thinking: "high" },
      "codex-cli": { family: "openai-gpt", thinking: "medium" },
    },
    very_strong: {
      "claude-code": { family: "claude-sonnet", effort: "max" },
      "mistral-vibe": { family: "mistral-medium", thinking: "max" },
      "codex-cli": { family: "openai-gpt", thinking: "high" },
    },
    frontier: {
      "claude-code": { family: "claude-opus", effort: "medium" },
      "codex-cli": { family: "openai-gpt", thinking: "xhigh", relationship: "fallback" },
    },
    max: {
      "claude-code": { family: "claude-opus", effort: "max" },
      "codex-cli": { family: "openai-gpt", thinking: "xhigh", relationship: "downgrade" },
    },
    ultra: {
      "claude-code": { family: "claude-opus", effort: "ultracode" },
    },
  },
  normalization: {
    "claude-haiku": { defaultTier: "cheap" },
    "claude-sonnet": {
      low: "fast",
      medium: "standard",
      high: "strong",
      max: "very_strong",
    },
    "claude-opus": {
      low: "frontier",
      medium: "frontier",
      high: "max",
      xhigh: "max",
      max: "max",
      ultracode: "ultra",
    },
    "mistral-medium": {
      off: "cheap",
      low: "fast",
      medium: "standard",
      high: "strong",
      max: "very_strong",
    },
    "openai-gpt": { low: "standard", medium: "strong", high: "very_strong", xhigh: "frontier" },
  },
  requestedModelNormalization: {
    "claude-haiku-4-5-20251001": "claude-haiku",
    "claude-sonnet-4-6": "claude-sonnet",
    "claude-opus-4-8": "claude-opus",
    haiku: "claude-haiku",
    sonnet: "claude-sonnet",
    opus: "claude-opus",
  },
};

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  providers: {
    "claude-code": {
      enabled: true,
      executable: "claude",
      families: {
        "claude-haiku": { model: "claude-haiku-4-5-20251001" },
        "claude-sonnet": { model: "claude-sonnet-4-6" },
        "claude-opus": { model: "claude-opus-4-8" },
      },
    },
    "mistral-vibe": {
      enabled: false,
      executable: "vibe",
      modelEnvVar: "VIBE_ACTIVE_MODEL",
      defaultAgent: "auto-approve",
      aliases: {
        "mistral-medium/off": "phax-mistral-medium-3.5-off",
        "mistral-medium/low": "phax-mistral-medium-3.5-low",
        "mistral-medium/medium": "phax-mistral-medium-3.5-medium",
        "mistral-medium/high": "phax-mistral-medium-3.5-high",
        "mistral-medium/max": "phax-mistral-medium-3.5-max",
      },
    },
    "codex-cli": {
      enabled: false,
      executable: "codex",
      families: {
        "openai-gpt": { model: "gpt-5.5" },
      },
    },
  },
};
