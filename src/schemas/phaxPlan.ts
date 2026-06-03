import { JSONSchema, Schema } from "effect";

const EffortSchema = Schema.Literal(
  "none",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
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

// What we ask Claude to extract from plan.md: only the human-authored fields.
// `branch` and `backend` are filled in deterministically by phax (from git and
// phax.json) so we never ask Claude to guess them.
export const ExtractedPhaxPlanSchema = Schema.Struct({
  version: Schema.Literal(1),
  run: Schema.Struct({
    shortName: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
});

// The full persisted plan, after phax merges in the deterministic fields.
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

export type ExtractedPhaxPlan = Schema.Schema.Type<typeof ExtractedPhaxPlanSchema>;
export type PhaxPlan = Schema.Schema.Type<typeof PhaxPlanSchema>;
export type PhaxPlanPhase = Schema.Schema.Type<typeof PhaseSchema>;
export type Effort = Schema.Schema.Type<typeof EffortSchema>;

export const decodePhaxPlan = Schema.decodeUnknownEither(PhaxPlanSchema, {
  onExcessProperty: "error",
});

export function getPhaxPlanJsonSchema(): object {
  return JSONSchema.make(PhaxPlanSchema);
}

export function getExtractedPlanJsonSchema(): object {
  return JSONSchema.make(ExtractedPhaxPlanSchema);
}
