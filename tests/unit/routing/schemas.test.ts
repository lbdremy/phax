import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ROUTING } from "../../../src/domain/routing/defaults.js";
import {
  ModelFamilySchema,
  ProviderIdSchema,
  RelationshipSchema,
  RoutingTierSchema,
  ThinkingLevelSchema,
  decodeModelRouting,
} from "../../../src/schemas/modelRouting.js";
import { decodeProviderConfig } from "../../../src/schemas/providerConfig.js";
import type {
  ModelFamily,
  ProviderId,
  Relationship,
  RoutingRequest,
  RoutingResolution,
  RoutingTier,
  ThinkingLevel,
} from "../../../src/domain/routing/types.js";

// Compile-time shape check: if fields are removed from the domain types, these
// type aliases fail. Exhaustive satisfies checks live in tests/type/routing.ts
// (phase-03 scope).
type CompileTimeRoutingRequest = RoutingRequest;
type CompileTimeRoutingResolution = RoutingResolution;

const decodeProviderId = Schema.decodeUnknownEither(ProviderIdSchema);
const decodeModelFamily = Schema.decodeUnknownEither(ModelFamilySchema);
const decodeThinkingLevel = Schema.decodeUnknownEither(ThinkingLevelSchema);
const decodeRoutingTier = Schema.decodeUnknownEither(RoutingTierSchema);
const decodeRelationship = Schema.decodeUnknownEither(RelationshipSchema);

const validModelRouting = {
  version: 1,
  providerPriority: ["claude-code"],
  allowDowngrade: false,
  defaultTier: "standard",
  families: {
    "claude-haiku": ["claude-haiku"],
    "claude-sonnet": ["claude-sonnet"],
    "claude-opus": ["claude-opus"],
    "mistral-medium": ["mistral-medium"],
    "openai-gpt": ["openai-gpt"],
  },
  tiers: {
    cheap: { "claude-code": { family: "claude-haiku" } },
    fast: { "claude-code": { family: "claude-haiku" } },
    standard: {
      "claude-code": { family: "claude-sonnet" },
      "mistral-vibe": { family: "mistral-medium", thinking: "medium", relationship: "equivalent" },
      "codex-cli": { family: "openai-gpt", thinking: "medium", relationship: "equivalent" },
    },
    strong: {
      "claude-code": { family: "claude-sonnet", effort: "high" },
      "codex-cli": { family: "openai-gpt", thinking: "medium", relationship: "equivalent" },
    },
    very_strong: {
      "claude-code": { family: "claude-sonnet", effort: "xhigh" },
    },
    "frontier-medium": {
      "claude-code": { family: "claude-opus" },
      "codex-cli": { family: "openai-gpt", thinking: "xhigh", relationship: "equivalent" },
    },
    "frontier-max": {
      "claude-code": { family: "claude-opus", effort: "max" },
      "codex-cli": { family: "openai-gpt", thinking: "max", relationship: "downgrade" },
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
      max: "frontier-medium",
    },
    "claude-opus": {
      low: "strong",
      medium: "frontier-medium",
      high: "frontier-max",
      xhigh: "frontier-max",
      max: "frontier-max",
    },
    "mistral-medium": { defaultTier: "standard" },
    "openai-gpt": { defaultTier: "standard" },
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

const validProviderConfig = {
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
        "openai-gpt": { model: "gpt-5.5" },
      },
    },
  },
};

describe("literal schemas", () => {
  it("ProviderIdSchema accepts all valid provider ids", () => {
    const ids: ProviderId[] = ["claude-code", "mistral-vibe", "codex-cli"];
    for (const id of ids) {
      expect(Either.isRight(decodeProviderId(id))).toBe(true);
    }
  });

  it("ProviderIdSchema rejects an invalid provider id", () => {
    expect(Either.isLeft(decodeProviderId("not-a-provider"))).toBe(true);
  });

  it("ModelFamilySchema accepts all valid families", () => {
    const families: ModelFamily[] = [
      "claude-haiku",
      "claude-sonnet",
      "claude-opus",
      "mistral-medium",
      "openai-gpt",
    ];
    for (const f of families) {
      expect(Either.isRight(decodeModelFamily(f))).toBe(true);
    }
  });

  it("ModelFamilySchema rejects an invalid family", () => {
    expect(Either.isLeft(decodeModelFamily("gpt-unknown"))).toBe(true);
  });

  it("ThinkingLevelSchema accepts all valid levels", () => {
    const levels: ThinkingLevel[] = [
      "none",
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultracode",
    ];
    for (const l of levels) {
      expect(Either.isRight(decodeThinkingLevel(l))).toBe(true);
    }
  });

  it("ThinkingLevelSchema rejects an invalid level", () => {
    expect(Either.isLeft(decodeThinkingLevel("insane"))).toBe(true);
  });

  it("RoutingTierSchema accepts all valid tiers", () => {
    const tiers: RoutingTier[] = [
      "cheap",
      "fast",
      "standard",
      "strong",
      "very_strong",
      "frontier-low",
      "frontier-medium",
      "frontier-high",
      "frontier-xhigh",
      "frontier-max",
      "frontier-ultra",
    ];
    for (const t of tiers) {
      expect(Either.isRight(decodeRoutingTier(t))).toBe(true);
    }
  });

  it("RoutingTierSchema rejects an invalid tier", () => {
    expect(Either.isLeft(decodeRoutingTier("ultraviolet"))).toBe(true);
  });

  it("RoutingTierSchema rejects the removed legacy tier literals", () => {
    for (const legacy of ["frontier", "max", "ultra"]) {
      expect(Either.isLeft(decodeRoutingTier(legacy))).toBe(true);
    }
  });

  it("RelationshipSchema accepts all valid relationships", () => {
    const rels: Relationship[] = ["exact", "equivalent", "fallback", "downgrade", "no_equivalent"];
    for (const r of rels) {
      expect(Either.isRight(decodeRelationship(r))).toBe(true);
    }
  });

  it("RelationshipSchema rejects an invalid relationship", () => {
    expect(Either.isLeft(decodeRelationship("close-enough"))).toBe(true);
  });
});

describe("ModelRoutingSchema", () => {
  it("decodes the spec §12 example", () => {
    expect(Either.isRight(decodeModelRouting(validModelRouting))).toBe(true);
  });

  it("decodes the shipped DEFAULT_MODEL_ROUTING", () => {
    expect(Either.isRight(decodeModelRouting(DEFAULT_MODEL_ROUTING))).toBe(true);
  });

  it("rejects a normalization map using a removed legacy tier literal", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      normalization: {
        ...validModelRouting.normalization,
        "claude-opus": { low: "frontier", medium: "frontier", max: "max" },
      },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = decodeModelRouting({ ...validModelRouting, unknownKey: "surprise" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an invalid provider id in providerPriority", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      providerPriority: ["not-a-provider"],
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an invalid routing tier in defaultTier", () => {
    const result = decodeModelRouting({ ...validModelRouting, defaultTier: "ultraviolet" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an invalid thinking level in a tier entry", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      tiers: {
        ...validModelRouting.tiers,
        standard: {
          "claude-code": { family: "claude-sonnet", thinking: "insane" },
        },
      },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an invalid model family in a tier entry", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      tiers: {
        ...validModelRouting.tiers,
        standard: {
          "claude-code": { family: "gpt-unknown" },
        },
      },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("accepts a normalization entry with defaultTier", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      normalization: { "claude-haiku": { defaultTier: "cheap" } },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("accepts a normalization entry with per-effort map", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      normalization: {
        "claude-sonnet": { off: "cheap", low: "fast", medium: "standard", high: "strong" },
      },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects an invalid model family in requestedModelNormalization value", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      requestedModelNormalization: { "my-model": "gpt-unknown" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("ProviderConfigSchema", () => {
  it("decodes the spec §13 example", () => {
    expect(Either.isRight(decodeProviderConfig(validProviderConfig))).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = decodeProviderConfig({ ...validProviderConfig, extra: true });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a provider entry with a non-boolean enabled field", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": { enabled: "yes", executable: "claude" },
      },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a provider entry with an empty executable", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": { enabled: true, executable: "" },
      },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("accepts a provider entry with all optional fields omitted", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": { enabled: true, executable: "claude" },
      },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects unknown keys inside a provider entry", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": { enabled: true, executable: "claude", unknownField: "oops" },
      },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
