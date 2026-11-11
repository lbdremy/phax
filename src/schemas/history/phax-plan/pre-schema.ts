// The frozen pre-schema shape of `phax-plan`: exactly what phax wrote before it
// wrote `$schema`. Never edit this module: packages/schemas/history.lock.json
// pins its bytes. In phax, only src/schemas/persisted.ts may import it. The
// schemas package re-exports its schema and type.
import { Schema } from "effect";

// `Schema.isPattern` whose JSON Schema is the RegExp's source, whatever its
// flags: Effect 4 exports a pattern only for a RegExp with the `u` flag.
function isExportedPattern(regExp: RegExp, annotations?: Schema.Annotations.Filter) {
  return Schema.isPattern(regExp, {
    toJsonSchema: () => ({ pattern: regExp.source }),
    ...annotations,
  });
}

const EffortSchema = Schema.Literals([
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultra",
]);

const PhaseSchema = Schema.Struct({
  id: Schema.String.check(isExportedPattern(/^phase-\d{2}$/)),
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

export const PhaxPlanPreSchemaSchema = Schema.Struct({
  version: Schema.Literal(1),
  run: Schema.Struct({
    shortName: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
    requiredCommands: Schema.Array(Schema.String),
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
});

export type PhaxPlanPreSchema = Schema.Schema.Type<typeof PhaxPlanPreSchemaSchema>;

export const decodePhaxPlanPreSchema = Schema.decodeUnknownResult(PhaxPlanPreSchemaSchema, {
  onExcessProperty: "error",
  reportInput: true,
});
