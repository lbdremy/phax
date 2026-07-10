import { Either, Schema } from "effect";
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
  RoutingRequest,
  RoutingResolution,
  ThinkingLevel,
} from "../../../src/domain/routing/types.js";

// Compile-time shape check: if fields are removed from the domain types, these
// type aliases fail. Exhaustive `satisfies` checks live in tests/type/routing.ts.
type CompileTimeRoutingRequest = RoutingRequest;
type CompileTimeRoutingResolution = RoutingResolution;

const decodeProviderId = Schema.decodeUnknownEither(ProviderIdSchema);
const decodeModelFamily = Schema.decodeUnknownEither(ModelFamilySchema);
const decodeThinkingLevel = Schema.decodeUnknownEither(ThinkingLevelSchema);
const decodeRelationship = Schema.decodeUnknownEither(RelationshipSchema);

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
      expect(Either.isRight(decodeRelationship(r))).toBe(true);
    }
  });

  it("RelationshipSchema rejects an invalid relationship", () => {
    expect(Either.isLeft(decodeRelationship("close-enough"))).toBe(true);
  });
});

describe("ModelRoutingSchema (v2)", () => {
  it("decodes a minimal valid v2 config", () => {
    expect(Either.isRight(decodeModelRouting(validModelRouting))).toBe(true);
  });

  it("decodes the shipped DEFAULT_MODEL_ROUTING", () => {
    expect(Either.isRight(decodeModelRouting(DEFAULT_MODEL_ROUTING))).toBe(true);
  });

  it("rejects a version-1 config outright (version literal is 2)", () => {
    const result = decodeModelRouting({ ...validModelRouting, version: 1 });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects the legacy tier scale — tiers is not a recognized key", () => {
    const legacy = {
      ...validModelRouting,
      tiers: { standard: { "claude-code": { family: "claude-sonnet" } } },
    };
    expect(Either.isLeft(decodeModelRouting(legacy))).toBe(true);
  });

  it("rejects the legacy normalization / defaultTier fields", () => {
    const legacy = {
      ...validModelRouting,
      defaultTier: "standard",
      normalization: { "claude-sonnet": { medium: "standard" } },
    };
    expect(Either.isLeft(decodeModelRouting(legacy))).toBe(true);
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

  it("rejects an invalid model family in requestedModelNormalization value", () => {
    const result = decodeModelRouting({
      ...validModelRouting,
      requestedModelNormalization: { "my-model": "gpt-unknown" },
    });
    expect(Either.isLeft(result)).toBe(true);
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
    expect(Either.isLeft(result)).toBe(true);
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
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("ProviderConfigSchema (per-entry efforts)", () => {
  it("decodes the shipped DEFAULT_PROVIDER_CONFIG", () => {
    expect(Either.isRight(decodeProviderConfig(DEFAULT_PROVIDER_CONFIG))).toBe(true);
  });

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
    expect(Either.isLeft(result)).toBe(true);
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
    expect(Either.isLeft(result)).toBe(true);
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
    expect(Either.isRight(result)).toBe(true);
  });
});
