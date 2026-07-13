import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";

export const DEFAULT_MODEL_ROUTING: ModelRouting = {
  version: 2,
  providerPriority: ["mistral-vibe", "codex-cli", "claude-code"],
  allowDowngrade: true,
  equivalence: {
    // OpenAI Codex — each supported effort of gpt-5.5 is anchored to the
    // Claude entry it is capability-equivalent to; edges are stated relative
    // to the Claude hub.
    "gpt-5.5": {
      low: { claude: "claude-sonnet-4-6", effort: "low", relation: "equivalent" },
      medium: { claude: "claude-sonnet-4-6", effort: "medium", relation: "equivalent" },
      high: { claude: "claude-sonnet-4-6", effort: "high", relation: "equivalent" },
      xhigh: { claude: "claude-opus-4-8", effort: "medium", relation: "equivalent" },
    },
    // OpenAI GPT-5.6 (Sol / Terra / Luna variants). Anchored to the Artificial
    // Analysis Agentic Index — a single axis scoring both vendors at top effort
    // (avg of GDPval-AA v2 + τ³-Banking; source: https://artificialanalysis.ai/):
    // Sol 54.0 ≈ Fable 5 52.8, Terra 47.4 ≈ Opus 4.8 47.2, Luna 45.6 ≈ Sonnet 5
    // 46.7 — all within ~1 point, so `equivalent`. Efforts map straight across;
    // each variant's top `ultra` tier anchors to its Claude peer's `max`. (Not
    // opus/ultracode: ultracode stays Claude's exclusive ceiling, never routed
    // cross-provider — see sameFamilyPreservation tests.)
    "gpt-5.6-sol": {
      low: { claude: "claude-fable-5", effort: "low", relation: "equivalent" },
      medium: { claude: "claude-fable-5", effort: "medium", relation: "equivalent" },
      high: { claude: "claude-fable-5", effort: "high", relation: "equivalent" },
      xhigh: { claude: "claude-fable-5", effort: "xhigh", relation: "equivalent" },
      max: { claude: "claude-fable-5", effort: "max", relation: "equivalent" },
      ultra: { claude: "claude-fable-5", effort: "max", relation: "equivalent" },
    },
    "gpt-5.6-terra": {
      low: { claude: "claude-opus-4-8", effort: "low", relation: "equivalent" },
      medium: { claude: "claude-opus-4-8", effort: "medium", relation: "equivalent" },
      high: { claude: "claude-opus-4-8", effort: "high", relation: "equivalent" },
      xhigh: { claude: "claude-opus-4-8", effort: "xhigh", relation: "equivalent" },
      max: { claude: "claude-opus-4-8", effort: "max", relation: "equivalent" },
      ultra: { claude: "claude-opus-4-8", effort: "max", relation: "equivalent" },
    },
    "gpt-5.6-luna": {
      low: { claude: "claude-sonnet-5", effort: "low", relation: "equivalent" },
      medium: { claude: "claude-sonnet-5", effort: "medium", relation: "equivalent" },
      high: { claude: "claude-sonnet-5", effort: "high", relation: "equivalent" },
      xhigh: { claude: "claude-sonnet-5", effort: "xhigh", relation: "equivalent" },
      max: { claude: "claude-sonnet-5", effort: "max", relation: "equivalent" },
    },
    // Mistral Vibe — one alias per effort, each anchored to its Claude peer.
    "phax-mistral-medium-3.5-off": {
      off: { claude: "claude-haiku-4-5-20251001", effort: "none", relation: "equivalent" },
    },
    "phax-mistral-medium-3.5-low": {
      low: { claude: "claude-sonnet-4-6", effort: "low", relation: "equivalent" },
    },
    "phax-mistral-medium-3.5-medium": {
      medium: { claude: "claude-sonnet-4-6", effort: "medium", relation: "equivalent" },
    },
    "phax-mistral-medium-3.5-high": {
      high: { claude: "claude-sonnet-4-6", effort: "high", relation: "equivalent" },
    },
    "phax-mistral-medium-3.5-max": {
      max: { claude: "claude-sonnet-4-6", effort: "max", relation: "equivalent" },
    },
  },
  requestedModelNormalization: {
    haiku: "claude-haiku",
    sonnet: "claude-sonnet",
    opus: "claude-opus",
    fable: "claude-fable",
  },
};

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  providers: {
    "claude-code": {
      enabled: true,
      executable: "claude",
      families: {
        "claude-haiku": {
          models: [
            {
              id: "claude-haiku-4-5-20251001",
              efforts: ["none"],
              status: "active",
            },
          ],
        },
        "claude-sonnet": {
          models: [
            {
              id: "claude-sonnet-4-6",
              efforts: ["low", "medium", "high", "max"],
              status: "active",
            },
            {
              id: "claude-sonnet-5",
              efforts: ["low", "medium", "high", "xhigh", "max"],
              status: "active",
            },
          ],
        },
        "claude-opus": {
          models: [
            {
              id: "claude-opus-4-8",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"],
              status: "active",
            },
          ],
        },
        "claude-fable": {
          models: [
            {
              id: "claude-fable-5",
              efforts: ["low", "medium", "high", "xhigh", "max"],
              status: "active",
            },
          ],
        },
      },
    },
    "mistral-vibe": {
      enabled: false,
      executable: "vibe",
      modelEnvVar: "VIBE_ACTIVE_MODEL",
      defaultAgent: "auto-approve",
      families: {
        "mistral-medium": {
          models: [
            { id: "phax-mistral-medium-3.5-off", efforts: ["off"], status: "active" },
            { id: "phax-mistral-medium-3.5-low", efforts: ["low"], status: "active" },
            { id: "phax-mistral-medium-3.5-medium", efforts: ["medium"], status: "active" },
            { id: "phax-mistral-medium-3.5-high", efforts: ["high"], status: "active" },
            { id: "phax-mistral-medium-3.5-max", efforts: ["max"], status: "active" },
          ],
        },
      },
    },
    "codex-cli": {
      enabled: false,
      executable: "codex",
      families: {
        "openai-gpt": {
          models: [
            {
              id: "gpt-5.5",
              efforts: ["low", "medium", "high", "xhigh"],
              status: "active",
            },
            {
              id: "gpt-5.6-sol",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
              status: "active",
            },
            {
              id: "gpt-5.6-terra",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
              status: "active",
            },
            {
              id: "gpt-5.6-luna",
              efforts: ["low", "medium", "high", "xhigh", "max"],
              status: "active",
            },
          ],
        },
      },
    },
  },
};
