import { Schema } from "effect";

export const PackageJsonSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  scripts: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  packageManager: Schema.optional(Schema.String),
});

export type PackageJson = Schema.Schema.Type<typeof PackageJsonSchema>;

export const decodePackageJson = Schema.decodeUnknownEither(PackageJsonSchema);
