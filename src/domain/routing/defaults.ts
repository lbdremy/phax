import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";

export const DEFAULT_MODEL_ROUTING: ModelRouting = {
  version: 1,
  providerPriority: ["claude-code"],
  allowDowngrade: false,
  defaultTier: "standard",
  families: {
    "claude-haiku": ["claude-haiku"],
    "claude-sonnet": ["claude-sonnet"],
    "claude-opus": ["claude-opus"],
    "mistral-medium": ["mistral-medium"],
    "openai-chatgpt": ["openai-chatgpt"],
  },
  tiers: {
    cheap: { "claude-code": { family: "claude-haiku" } },
    fast: { "claude-code": { family: "claude-haiku" } },
    standard: {
      "claude-code": { family: "claude-sonnet" },
      "mistral-vibe": { family: "mistral-medium", thinking: "medium", relationship: "equivalent" },
      "codex-cli": { family: "openai-chatgpt", thinking: "medium", relationship: "equivalent" },
    },
    strong: {
      "claude-code": { family: "claude-sonnet", effort: "high" },
      "codex-cli": { family: "openai-chatgpt", thinking: "medium", relationship: "equivalent" },
    },
    very_strong: {
      "claude-code": { family: "claude-sonnet", effort: "xhigh" },
    },
    frontier: {
      "claude-code": { family: "claude-opus" },
      "codex-cli": { family: "openai-chatgpt", thinking: "xhigh", relationship: "fallback" },
    },
    max: {
      "claude-code": { family: "claude-opus", effort: "max" },
      "codex-cli": { family: "openai-chatgpt", thinking: "max", relationship: "downgrade" },
    },
  },
  normalization: {
    "claude-haiku": { defaultTier: "cheap" },
    "claude-sonnet": {
      off: "cheap",
      low: "fast",
      medium: "standard",
      high: "strong",
      xhigh: "very_strong",
      max: "frontier",
    },
    "claude-opus": {
      low: "strong",
      medium: "frontier",
      high: "max",
      xhigh: "max",
      max: "max",
    },
    "mistral-medium": { defaultTier: "standard" },
    "openai-chatgpt": { defaultTier: "standard" },
  },
  requestedModelNormalization: {
    "claude-haiku-4-5-20251001": "claude-haiku",
    "claude-sonnet-4-6": "claude-sonnet",
    "claude-opus-4-7": "claude-opus",
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
        "claude-opus": { model: "claude-opus-4-7" },
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
        "openai-chatgpt": { model: "gpt-5.5" },
      },
    },
  },
};
