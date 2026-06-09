import { Schema } from "effect";

const RunStateSchema = Schema.Union(
  Schema.Literal("created"),
  Schema.Literal("running"),
  Schema.Literal("failed"),
  Schema.Literal("review_open"),
  Schema.Literal("completed"),
  Schema.Literal("stopped"),
  Schema.Literal("archived"),
  Schema.Literal("interrupted"),
  Schema.Literal("rate_limited"),
);

export const RegistryEntrySchema = Schema.Struct({
  shortName: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  state: RunStateSchema,
  branch: Schema.NonEmptyString,
  projectName: Schema.NonEmptyString,
  phasesCount: Schema.Number,
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
  archivePath: Schema.optionalWith(Schema.NonEmptyString, { exact: true }),
});

export type RegistryEntry = Schema.Schema.Type<typeof RegistryEntrySchema>;

export const RegistrySchema = Schema.Struct({
  version: Schema.Literal(1),
  runs: Schema.Array(RegistryEntrySchema),
});

export type Registry = Schema.Schema.Type<typeof RegistrySchema>;

export const decodeRegistry = Schema.decodeUnknownEither(RegistrySchema);
export const encodeRegistry = Schema.encodeSync(RegistrySchema);
