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

export const RelationshipSchema = Schema.Literal(
  "exact",
  "equivalent",
  "upgrade",
  "fallback",
  "downgrade",
  "no_equivalent",
);

// A single directed edge from a non-Claude ("spoke") catalog entry at a given
// effort to a Claude ("hub") catalog entry at a given effort. The relation is
// stated relative to the hub — hub→spoke translation uses it directly,
// spoke→hub translation inverts it (downgrade ↔ upgrade).
const EquivalenceEdgeSchema = Schema.Struct({
  claude: Schema.NonEmptyString,
  effort: ThinkingLevelSchema,
  relation: RelationshipSchema,
});

// The key is a ThinkingLevel string but the record is inherently partial —
// spoke entries support only a subset of efforts. Modeling the key as
// Schema.String keeps the decoded type Record-shaped without forcing every
// effort to be present.
const EquivalenceSpokeSchema = Schema.Record({
  key: Schema.String,
  value: EquivalenceEdgeSchema,
});

export const ModelRoutingSchema = Schema.Struct({
  version: Schema.Literal(2),
  providerPriority: Schema.NonEmptyArray(ProviderIdSchema),
  allowDowngrade: Schema.Boolean,
  equivalence: Schema.Record({
    key: Schema.String,
    value: EquivalenceSpokeSchema,
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
