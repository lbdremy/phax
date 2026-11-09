import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import {
  ModelFamilySchema,
  ProviderIdSchema,
  RelationshipSchema,
  ThinkingLevelSchema,
  decodeModelRouting,
} from "../../../src/schemas/modelRouting.js";
import { decodeProviderConfig } from "../../../src/schemas/providerConfig.js";
import type {
  ModelFamily,
  ProviderId,
  Relationship,
  ThinkingLevel,
} from "../../../src/domain/routing/types.js";

const decodeProviderId = Schema.decodeUnknownResult(ProviderIdSchema);
const decodeModelFamily = Schema.decodeUnknownResult(ModelFamilySchema);
const decodeThinkingLevel = Schema.decodeUnknownResult(ThinkingLevelSchema);
const decodeRelationship = Schema.decodeUnknownResult(RelationshipSchema);

const validModelRouting = {
  version: 2,
  providerPriority: ["claude-code"],
  allowDowngrade: false,
  equivalence: {
    "gpt-5.5": {
      medium: { claude: "claude-sonnet-4-6", effort: "medium", relation: "equivalent" },
      xhigh: { claude: "claude-opus-4-8", effort: "medium", relation: "equivalent" },
    },
  },
  requestedModelNormalization: {
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
        "claude-sonnet": {
          models: [
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
              id: "claude-opus-4-8",
              efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"],
              status: "active",
            },
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
            { id: "gpt-5.5", efforts: ["low", "medium", "high", "xhigh"], status: "active" },
          ],
        },
      },
    },
  },
};

describe("literal schemas", () => {
  it("ProviderIdSchema accepts all valid provider ids", () => {
    const ids: ProviderId[] = ["claude-code", "mistral-vibe", "codex-cli"];
    for (const id of ids) {
      expect(Result.isSuccess(decodeProviderId(id))).toBe(true);
    }
  });

  it("ProviderIdSchema rejects an invalid provider id", () => {
    expect(Result.isFailure(decodeProviderId("not-a-provider"))).toBe(true);
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
      expect(Result.isSuccess(decodeModelFamily(f))).toBe(true);
    }
  });

  it("ModelFamilySchema rejects an invalid family", () => {
    expect(Result.isFailure(decodeModelFamily("gpt-unknown"))).toBe(true);
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
      expect(Result.isSuccess(decodeThinkingLevel(l))).toBe(true);
    }
  });

  it("ThinkingLevelSchema rejects an invalid level", () => {
    expect(Result.isFailure(decodeThinkingLevel("insane"))).toBe(true);
  });

  it("RelationshipSchema accepts every relation including upgrade", () => {
    const rels: Relationship[] = [
      "exact",
      "equivalent",
      "upgrade",
      "fallback",
      "downgrade",
      "no_equivalent",
    ];
    for (const r of rels) {
      expect(Result.isSuccess(decodeRelationship(r))).toBe(true);
    }
  });

  it("RelationshipSchema rejects an invalid relationship", () => {
    expect(Result.isFailure(decodeRelationship("close-enough"))).toBe(true);
  });
});

describe("ModelRoutingSchema (v2)", () => {
  it("decodes a minimal valid v2 config", () => {
    expect(Result.isSuccess(decodeModelRouting(validModelRouting))).toBe(true);
  });

  it("decodes the shipped DEFAULT_MODEL_ROUTING", () => {
    expect(Result.isSuccess(decodeModelRouting(DEFAULT_MODEL_ROUTING))).toBe(true);
  });

  it("rejects a version-1 config outright (version literal is 2)", () => {
    const result = decodeModelRouting({ ...validModelRouting, version: 1 });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects the legacy tier scale — tiers is not a recognized key", () => {
    const legacy = {
      ...validModelRouting,
      tiers: { standard: { "claude-code": { family: "claude-sonnet" } } },
    };
    expect(Result.isFailure(decodeModelRouting(legacy))).toBe(true);
  });

  it("rejects the legacy normalization / defaultTier fields", () => {
    const legacy = {
      ...validModelRouting,
      defaultTier: "standard",
      normalization: { "claude-sonnet": { medium: "standard" } },
    };
    expect(Result.isFailure(decodeModelRouting(legacy))).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = decodeModelRouting({ ...validModelRouting, unknownKey: "surprise" });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects an invalid provider id in providerPriority", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      providerPriority: ["not-a-provider"],
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects an invalid model family in requestedModelNormalization value", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      requestedModelNormalization: { "my-model": "gpt-unknown" },
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects an equivalence edge with an invalid ThinkingLevel", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      equivalence: {
        "gpt-5.5": {
          medium: { claude: "claude-sonnet-4-6", effort: "insane", relation: "equivalent" },
        },
      },
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects an equivalence edge with an invalid relation", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      equivalence: {
        "gpt-5.5": {
          medium: { claude: "claude-sonnet-4-6", effort: "medium", relation: "close-enough" },
        },
      },
    });
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe("ProviderConfigSchema (per-entry efforts)", () => {
  it("decodes the shipped DEFAULT_PROVIDER_CONFIG", () => {
    expect(Result.isSuccess(decodeProviderConfig(DEFAULT_PROVIDER_CONFIG))).toBe(true);
  });

  it("decodes the spec §13 example", () => {
    expect(Result.isSuccess(decodeProviderConfig(validProviderConfig))).toBe(true);
  });

  it("rejects unknown top-level keys", () => {
    const result = decodeProviderConfig({ ...validProviderConfig, extra: true });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects a provider entry with a non-boolean enabled field", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": { enabled: "yes", executable: "claude" },
      },
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects a provider entry with an empty executable", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": { enabled: true, executable: "" },
      },
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("accepts a provider entry with all optional fields omitted", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": { enabled: true, executable: "claude" },
      },
    });
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("rejects unknown keys inside a provider entry", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": { enabled: true, executable: "claude", unknownField: "oops" },
      },
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects a family entry with an empty models array", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": {
          enabled: true,
          executable: "claude",
          families: { "claude-sonnet": { models: [] } },
        },
      },
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects a catalog entry with an unknown status", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": {
          enabled: true,
          executable: "claude",
          families: {
            "claude-sonnet": {
              models: [{ id: "claude-sonnet-4-6", efforts: ["low"], status: "retired" }],
            },
          },
        },
      },
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("accepts coexisting versions as distinct catalog entries", () => {
    const result = decodeProviderConfig({
      providers: {
        "claude-code": {
          enabled: true,
          executable: "claude",
          families: {
            "claude-opus": {
              models: [
                {
                  id: "claude-opus-4-8",
                  efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"],
                  status: "active",
                },
                {
                  id: "claude-opus-4-7",
                  efforts: ["low", "medium", "high", "xhigh", "max"],
                  status: "deprecated",
                },
              ],
            },
          },
        },
      },
    });
    expect(Result.isSuccess(result)).toBe(true);
  });
});
