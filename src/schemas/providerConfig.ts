import { Schema } from "effect";
import { ThinkingLevelSchema } from "./modelRouting.js";

export const CatalogEntryStatusSchema = Schema.Literals(["active", "deprecated"]);

const CatalogEntrySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  efforts: Schema.NonEmptyArray(ThinkingLevelSchema),
  status: CatalogEntryStatusSchema,
});

const ProviderFamilyEntrySchema = Schema.Struct({
  models: Schema.NonEmptyArray(CatalogEntrySchema),
});

const ProviderEntrySchema = Schema.Struct({
  enabled: Schema.Boolean,
  executable: Schema.NonEmptyString,
  modelEnvVar: Schema.optional(Schema.NonEmptyString),
  defaultAgent: Schema.optional(Schema.NonEmptyString),
  output: Schema.optional(Schema.NonEmptyString),
  families: Schema.optional(
    // The key is a ModelFamily string but each provider serves only a subset
    // of families. Modeling the key as Schema.String keeps the decoded type
    // Record-shaped without forcing every family to be present.
    Schema.Record(Schema.String, ProviderFamilyEntrySchema),
  ),
});

export const ProviderConfigSchema = Schema.Struct({
  providers: Schema.Record(Schema.String, ProviderEntrySchema),
});

export type ProviderConfig = Schema.Schema.Type<typeof ProviderConfigSchema>;
export type CatalogEntry = Schema.Schema.Type<typeof CatalogEntrySchema>;
export type ProviderFamilyEntry = Schema.Schema.Type<typeof ProviderFamilyEntrySchema>;

export const decodeProviderConfig = Schema.decodeUnknownResult(ProviderConfigSchema, {
  onExcessProperty: "error",
  reportInput: true,
});
