// The frozen 0.17.0 shape of `registry`: the registry.json phax 0.17.0
// through 0.26.x wrote, `$schema` first and no `awaiting_review` run state.
// Never edit this module: packages/schemas/history.lock.json pins its bytes.
// In phax, only src/schemas/persisted.ts may import it; the schemas package
// lists it as the format's 0.17.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/registry\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The registry format and the phax release that wrote this file: https://docs.phax.run/schemas/registry/<X.Y.Z>.json",
  }),
);

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

const RegistryEntryV0_17_0Schema = Schema.Struct({
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

export const RegistryV0_17_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  runs: Schema.Array(RegistryEntryV0_17_0Schema),
});

export type RegistryV0_17_0 = Schema.Schema.Type<typeof RegistryV0_17_0Schema>;

export const decodeRegistryV0_17_0 = Schema.decodeUnknownEither(RegistryV0_17_0Schema);
