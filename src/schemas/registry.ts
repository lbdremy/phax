import { Schema } from "effect";
import { schemaUrlField } from "./schemaUrl.js";

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
  namespace: Schema.NonEmptyString,
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

const RunsSchema = Schema.Array(RegistryEntrySchema);

/** The run registry in memory: never a `version`, never a `$schema`. */
export type Registry = { readonly runs: ReadonlyArray<RegistryEntry> };

/** `registry.json` as phax writes it: `$schema` first, then the runs. Unknown keys are ignored. */
export const RegistryFileSchema = Schema.Struct({
  $schema: schemaUrlField("registry"),
  runs: RunsSchema,
});

export type RegistryFile = Schema.Schema.Type<typeof RegistryFileSchema>;

export const decodeRegistryFile = Schema.decodeUnknownEither(RegistryFileSchema);
export const encodeRegistryFile = Schema.encodeSync(RegistryFileSchema);
