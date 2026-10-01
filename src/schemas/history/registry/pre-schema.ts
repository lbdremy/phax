// The frozen pre-schema shape of `registry`: exactly what phax wrote before it
// wrote `$schema`. Never edit this module: packages/schemas/history.lock.json
// pins its bytes. In phax, only src/schemas/persisted.ts may import it. The
// schemas package re-exports its schema and type.
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

const RegistryEntrySchema = Schema.Struct({
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

export const RegistryPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(1),
  runs: Schema.Array(RegistryEntrySchema),
});

export type RegistryPreSchema = Schema.Schema.Type<typeof RegistryPreSchemaSchema>;

export const decodeRegistryPreSchema = Schema.decodeUnknownEither(RegistryPreSchemaSchema);
