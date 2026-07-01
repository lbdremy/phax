import { Schema } from "effect";

export const ProviderIdSchema = Schema.Literal("claude-code", "mistral-vibe", "codex-cli");

export const ModelFamilySchema = Schema.Literal(
  "claude-haiku",
  "claude-sonnet",
  "claude-opus",
  "mistral-medium",
  "openai-gpt",
);

export const ThinkingLevelSchema = Schema.Literal(
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
);

export const RoutingTierSchema = Schema.Literal(
  "cheap",
  "fast",
  "standard",
  "strong",
  "sonnet-xhigh",
  "very_strong",
  "frontier-low",
  "frontier-medium",
  "frontier-high",
  "frontier-xhigh",
  "frontier-max",
  "frontier-ultra",
);

export const RelationshipSchema = Schema.Literal(
  "exact",
  "equivalent",
  "fallback",
  "downgrade",
  "no_equivalent",
);

const TierEntrySchema = Schema.Struct({
  family: ModelFamilySchema,
  effort: Schema.optional(ThinkingLevelSchema),
  thinking: Schema.optional(ThinkingLevelSchema),
  relationship: Schema.optional(RelationshipSchema),
});

const DefaultTierNormalizationSchema = Schema.Struct({
  defaultTier: RoutingTierSchema,
});

const PerEffortNormalizationSchema = Schema.Struct({
  none: Schema.optional(RoutingTierSchema),
  off: Schema.optional(RoutingTierSchema),
  low: Schema.optional(RoutingTierSchema),
  medium: Schema.optional(RoutingTierSchema),
  high: Schema.optional(RoutingTierSchema),
  xhigh: Schema.optional(RoutingTierSchema),
  max: Schema.optional(RoutingTierSchema),
  ultracode: Schema.optional(RoutingTierSchema),
});

const NormalizationEntrySchema = Schema.Union(
  DefaultTierNormalizationSchema,
  PerEffortNormalizationSchema,
);

export const ModelRoutingSchema = Schema.Struct({
  version: Schema.Literal(1),
  providerPriority: Schema.NonEmptyArray(ProviderIdSchema),
  allowDowngrade: Schema.Boolean,
  defaultTier: RoutingTierSchema,
  families: Schema.Record({ key: Schema.String, value: Schema.Array(ModelFamilySchema) }),
  tiers: Schema.Record({
    key: Schema.String,
    value: Schema.Record({
      key: Schema.String,
      value: TierEntrySchema,
    }),
  }),
  normalization: Schema.Record({
    key: Schema.String,
    value: NormalizationEntrySchema,
  }),
  requestedModelNormalization: Schema.Record({
    key: Schema.String,
    value: ModelFamilySchema,
  }),
});

export type ModelRouting = Schema.Schema.Type<typeof ModelRoutingSchema>;

export const decodeModelRouting = Schema.decodeUnknownEither(ModelRoutingSchema, {
  onExcessProperty: "error",
});
