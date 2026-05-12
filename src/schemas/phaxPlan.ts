import { JSONSchema, Schema } from "effect";

const EffortSchema = Schema.Literal("low", "medium", "high");

const PhaseSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  planMarkdownAnchor: Schema.NonEmptyString,
  commit: Schema.Struct({
    subject: Schema.NonEmptyString,
    body: Schema.NonEmptyString,
  }),
});

export const PhaxPlanSchema = Schema.Struct({
  version: Schema.Literal(1),
  run: Schema.Struct({
    shortName: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
    backend: Schema.NonEmptyString,
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
});

export type PhaxPlan = Schema.Schema.Type<typeof PhaxPlanSchema>;
export type PhaxPlanPhase = Schema.Schema.Type<typeof PhaseSchema>;
export type Effort = Schema.Schema.Type<typeof EffortSchema>;

export const decodePhaxPlan = Schema.decodeUnknownEither(PhaxPlanSchema, {
  onExcessProperty: "error",
});

export function getPhaxPlanJsonSchema(): object {
  return JSONSchema.make(PhaxPlanSchema);
}
