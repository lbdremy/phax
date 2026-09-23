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
    // OpenAI GPT-6 Sol — anchored straight across to claude-opus-5-5 on the
    // Artificial Analysis Intelligence Index (leaderboard read 2026-09-23, a
    // re-scaled revision — compare only within this read): Sol 34/40/43/44/48
    // vs Opus 5.5 42/51/54/56/58 at low/medium/high/xhigh/max. Sol sits
    // between Sonnet 5 (24/28/32/34/38) and Opus 5.5 with no Claude entry
    // within a point, so the honest hub-centric relation is `downgrade` at
    // every effort. `ultra` anchors to `max` so `ultracode` stays Claude-only.
    "gpt-6-sol": {
      low: { claude: "claude-opus-5-5", effort: "low", relation: "downgrade" },
      medium: { claude: "claude-opus-5-5", effort: "medium", relation: "downgrade" },
      high: { claude: "claude-opus-5-5", effort: "high", relation: "downgrade" },
      xhigh: { claude: "claude-opus-5-5", effort: "xhigh", relation: "downgrade" },
      max: { claude: "claude-opus-5-5", effort: "max", relation: "downgrade" },
      ultra: { claude: "claude-opus-5-5", effort: "max", relation: "downgrade" },
    },
    // OpenAI GPT-6 Luna — anchored straight across to claude-sonnet-5 on the
    // same 2026-09-23 read: Luna 21/29/32/34/37 vs Sonnet 5 24/28/32/34/38.
    // Within a point from `medium` up, hence `equivalent`; at `low` Luna is 3
    // points under, hence `downgrade`. Luna's ladder caps at `max`.
    "gpt-6-luna": {
      low: { claude: "claude-sonnet-5", effort: "low", relation: "downgrade" },
      medium: { claude: "claude-sonnet-5", effort: "medium", relation: "equivalent" },
      high: { claude: "claude-sonnet-5", effort: "high", relation: "equivalent" },
      xhigh: { claude: "claude-sonnet-5", effort: "xhigh", relation: "equivalent" },
      max: { claude: "claude-sonnet-5", effort: "max", relation: "equivalent" },
    },
    // OpenAI GPT-6 Astra — anchored straight across to claude-fable-5-1 on the
    // Artificial Analysis Intelligence Index (leaderboard read 2026-09-23, a
    // re-scaled revision): Astra 46/50/51/52/53 vs Fable 5.1 47/49/51/53/53 at
    // low/medium/high/xhigh/max — within 1 point everywhere, so `equivalent`.
    // (Plan 59's `downgrade` came from the older 2026-09-07 index revision.)
    // `ultra` anchors to `max` so `ultracode` stays Claude-only.
    "gpt-6-astra": {
      low: { claude: "claude-fable-5-1", effort: "low", relation: "equivalent" },
      medium: { claude: "claude-fable-5-1", effort: "medium", relation: "equivalent" },
      high: { claude: "claude-fable-5-1", effort: "high", relation: "equivalent" },
      xhigh: { claude: "claude-fable-5-1", effort: "xhigh", relation: "equivalent" },
      max: { claude: "claude-fable-5-1", effort: "max", relation: "equivalent" },
      ultra: { claude: "claude-fable-5-1", effort: "max", relation: "equivalent" },
    },
    // OpenAI GPT-5.6 (Sol / Terra / Luna variants) — deprecated upstream in
    // codex 0.156.1 (Sol and Terra carry `upgrade.model: gpt-6-sol`, Luna
    // `gpt-6-luna`). Their entries and edges are kept, never deleted: a
    // deprecated spoke still falls back to its Claude anchor (spoke → hub),
    // while `hubToSpoke` skips it, so a Claude phase is never routed onto one.
    // Anchors are the ones set in July 2026 on the Artificial Analysis Agentic
    // Index — a single axis scoring both vendors at top effort (avg of
    // GDPval-AA v2 + τ³-Banking; source: https://artificialanalysis.ai/):
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
      // `ultracode` is listed on every entry that supports `xhigh`: Claude
      // Code gates ultracode on xhigh support, not on a specific model
      // (verified against 2.1.263).
      //
      // Entries within a family are listed newest-first: `pickActiveEntry`
      // (src/domain/routing/resolve.ts) resolves an alias or unknown id to
      // the first active entry of its family, so the first entry is the
      // family's current model.
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
              id: "claude-sonnet-5",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"],
              status: "active",
            },
            {
              id: "claude-sonnet-4-6",
              efforts: ["low", "medium", "high", "max"],
              status: "active",
            },
          ],
        },
        "claude-opus": {
          models: [
            {
              id: "claude-opus-5-5",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"],
              status: "active",
            },
            {
              id: "claude-opus-5",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"],
              status: "active",
            },
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
              id: "claude-fable-5-1",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"],
              status: "active",
            },
            {
              id: "claude-fable-5",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"],
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
        // Newest-first, like the Claude families: `pickActiveEntry` resolves
        // the `gpt` alias and unknown gpt ids to the first active entry. The
        // GPT-5.6 variants stay listed as `deprecated` — codex 0.156.1 points
        // each of them at a GPT-6 replacement, and a retired id is never
        // deleted from the catalog.
        "openai-gpt": {
          models: [
            {
              id: "gpt-6-sol",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
              status: "active",
            },
            {
              id: "gpt-6-luna",
              efforts: ["low", "medium", "high", "xhigh", "max"],
              status: "active",
            },
            {
              id: "gpt-6-astra",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
              status: "active",
            },
            {
              id: "gpt-5.6-luna",
              efforts: ["low", "medium", "high", "xhigh", "max"],
              status: "deprecated",
            },
            {
              id: "gpt-5.6-terra",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
              status: "deprecated",
            },
            {
              id: "gpt-5.6-sol",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
              status: "deprecated",
            },
            {
              id: "gpt-5.5",
              efforts: ["low", "medium", "high", "xhigh"],
              status: "active",
            },
          ],
        },
      },
    },
  },
};
