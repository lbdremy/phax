import { Schema } from "effect";

const ProviderEntrySchema = Schema.Struct({
  enabled: Schema.Boolean,
  executable: Schema.NonEmptyString,
  modelEnvVar: Schema.optional(Schema.NonEmptyString),
  defaultAgent: Schema.optional(Schema.NonEmptyString),
  output: Schema.optional(Schema.NonEmptyString),
  families: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Struct({ model: Schema.NonEmptyString }),
    }),
  ),
  aliases: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.NonEmptyString })),
});

export const ProviderConfigSchema = Schema.Struct({
  providers: Schema.Record({
    key: Schema.String,
    value: ProviderEntrySchema,
  }),
});

export type ProviderConfig = Schema.Schema.Type<typeof ProviderConfigSchema>;

export const decodeProviderConfig = Schema.decodeUnknownEither(ProviderConfigSchema, {
  onExcessProperty: "error",
});
