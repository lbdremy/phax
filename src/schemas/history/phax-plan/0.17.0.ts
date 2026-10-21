// The frozen 0.17.0 shape of `phax-plan`: the phax-plan.json phax 0.17.0
// through 0.25.x wrote, `$schema` first and phases ending with `commit`, no
// `mode` and no `oracle`. Never edit this module: packages/schemas/history.lock.json
// pins its bytes. In phax, only src/schemas/persisted.ts may import it. The
// schemas package lists it as the format's 0.17.0 release.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/phax-plan\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The phax-plan format and the phax release that wrote this file: https://docs.phax.run/schemas/phax-plan/<X.Y.Z>.json",
  }),
);

const EffortSchema = Schema.Literal(
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultra",
);

const PhaseSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/)),
  title: Schema.NonEmptyString,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  planMarkdownAnchor: Schema.NonEmptyString,
  plannedFilesToCreate: Schema.Array(Schema.String),
  plannedFilesToEdit: Schema.Array(Schema.String),
  optionalFilesToEdit: Schema.Array(Schema.String),
  commit: Schema.Struct({
    subject: Schema.NonEmptyString,
    body: Schema.NonEmptyString,
  }),
});

export const PhaxPlanV0_17_0Schema = Schema.Struct({
  $schema: SchemaUrlSchema,
  run: Schema.Struct({
    shortName: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
    requiredCommands: Schema.Array(Schema.String),
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
});

export type PhaxPlanV0_17_0 = Schema.Schema.Type<typeof PhaxPlanV0_17_0Schema>;

export const decodePhaxPlanV0_17_0 = Schema.decodeUnknownEither(PhaxPlanV0_17_0Schema, {
  onExcessProperty: "error",
});
