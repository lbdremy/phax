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

// What the model is asked to emit per phase. `title` is deliberately absent: it
// is derived deterministically from the plan.md heading (see `extractPlanCore`),
// not round-tripped through the model's JSON. A `"` in a title would otherwise
// derail the model into malformed output, which the strict `onExcessProperty`
// decode rejects — keeping the trip-wire but removing the failure mode.
const ExtractedPhaseSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/)),
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

// The persisted phase: the extracted fields plus the heading-derived `title`.
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
    // Loose on purpose: the model is unreliable at emitting a valid slug, so we
    // accept any non-empty string here and slugify it ourselves in
    // `extractPlanCore` (see `slugifyShortName`).
    shortName: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
    requiredCommands: Schema.Array(Schema.String),
  }),
  phases: Schema.NonEmptyArray(ExtractedPhaseSchema),
});

// The full persisted plan, after phax merges in the deterministic fields.
export const PhaxPlanSchema = Schema.Struct({
  version: Schema.Literal(1),
  run: Schema.Struct({
    shortName: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
    requiredCommands: Schema.Array(Schema.String),
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
