import { JSONSchema, Schema, type Types } from "effect";
import { schemaUrlField } from "./schemaUrl.js";
import { TestLineSchema } from "./testLine.js";

/** phax's effort vocabulary: a plan phase's `effort`, and a bound's `effort.min` and `effort.max`. */
export const PlanEffortSchema = Schema.Literal(
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

/** How a phase runs: headless, or kept open for a person (interactive-phases). */
export const PhaseModeSchema = Schema.Literal("headless", "interactive");

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

/**
 * A phase's oracle (oracle-phases): the phase that discharges it and the files
 * it pins, or null. An empty `files` list is admitted here: whether a plan's
 * oracle is well formed beyond its shape is a lint rule.
 */
export const PhaseOracleSchema = Schema.NullOr(
  Schema.Struct({
    dischargedBy: PhaseIdSchema,
    files: Schema.Array(Schema.NonEmptyString),
  }),
);

// The fields of an extracted phase. `title` is deliberately absent: it is
// derived deterministically from the plan.md heading (see `finalizeExtractedPlan`),
// not round-tripped through the model's JSON. A `"` in a title would otherwise
// derail the model into malformed output, which the strict `onExcessProperty`
// decode rejects — keeping the trip-wire but removing the failure mode.
// `mode` and `oracle` are phax's own reading of the phase's header lines in
// plan.md (`phaseKinds`), as the title is its reading of the heading, so the
// model's answer (`ExtractionAnswerSchema`) leaves them out too. `testLines`
// are extracted on both paths: the deterministic parser reads the phase's
// `### Test strategy` section, and the model emits them through the same
// `TestLineSchema`.
// The fields are exported on their own so the plan document (planDocument.ts)
// carries exactly these schemas rather than a copy that could drift.
export const ExtractedPhaseFields = {
  id: PhaseIdSchema,
  model: Schema.NonEmptyString,
  effort: PlanEffortSchema,
  planMarkdownAnchor: Schema.NonEmptyString,
  plannedFilesToCreate: Schema.Array(Schema.String),
  plannedFilesToEdit: Schema.Array(Schema.String),
  optionalFilesToEdit: Schema.Array(Schema.String),
  mode: PhaseModeSchema,
  oracle: PhaseOracleSchema,
  testLines: Schema.Array(TestLineSchema),
  commit: Schema.Struct({
    subject: Schema.NonEmptyString,
    body: Schema.NonEmptyString,
  }),
};

const ExtractedPhaseSchema = Schema.Struct(ExtractedPhaseFields);

// What the extraction model emits per phase: the extracted fields, test lines
// included, without the two phax reads from the header lines.
const { mode: _mode, oracle: _oracle, ...answerPhaseFields } = ExtractedPhaseFields;

export const ExtractedRunSchema = Schema.Struct({
  // Loose on purpose: the model is unreliable at emitting a valid slug, so we
  // accept any non-empty string here and slugify it ourselves in
  // `finalizeExtractedPlan` (see `slugifyShortName`).
  shortName: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  requiredCommands: Schema.Array(Schema.String),
});

// The persisted phase: the extracted fields plus the heading-derived `title`.
const PhaseSchema = Schema.Struct({
  id: ExtractedPhaseFields.id,
  title: Schema.NonEmptyString,
  model: ExtractedPhaseFields.model,
  effort: ExtractedPhaseFields.effort,
  planMarkdownAnchor: ExtractedPhaseFields.planMarkdownAnchor,
  plannedFilesToCreate: ExtractedPhaseFields.plannedFilesToCreate,
  plannedFilesToEdit: ExtractedPhaseFields.plannedFilesToEdit,
  optionalFilesToEdit: ExtractedPhaseFields.optionalFilesToEdit,
  mode: ExtractedPhaseFields.mode,
  oracle: ExtractedPhaseFields.oracle,
  testLines: ExtractedPhaseFields.testLines,
  commit: ExtractedPhaseFields.commit,
});

// What we ask Claude to extract from plan.md: only the human-authored fields.
// `branch` and `backend` are filled in deterministically by phax (from git and
// phax.json) so we never ask Claude to guess them.
export const ExtractedPhaxPlanSchema = Schema.Struct({
  version: Schema.Literal(1),
  run: ExtractedRunSchema,
  phases: Schema.NonEmptyArray(ExtractedPhaseSchema),
});

/**
 * The extraction model's answer: the extracted plan whose phases carry no
 * `mode` and no `oracle`; its `testLines` are the model's. phax adds both from plan.md's header lines
 * (`withPhaseKinds`), then decodes the result as `ExtractedPhaxPlanSchema`.
 */
export const ExtractionAnswerSchema = Schema.Struct({
  version: Schema.Literal(1),
  run: ExtractedRunSchema,
  phases: Schema.NonEmptyArray(Schema.Struct(answerPhaseFields)),
});

// The full plan, after phax merges in the deterministic fields.
const phaxPlanFields = {
  run: Schema.Struct({
    shortName: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
    requiredCommands: Schema.Array(Schema.String),
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
};

export type ExtractedPhaxPlan = Schema.Schema.Type<typeof ExtractedPhaxPlanSchema>;
export type ExtractionAnswer = Schema.Schema.Type<typeof ExtractionAnswerSchema>;
/** A run's plan in memory: never a `version`, never a `$schema`. */
export type PhaxPlan = Types.Simplify<Schema.Struct.Type<typeof phaxPlanFields>>;
export type PhaxPlanPhase = Schema.Schema.Type<typeof PhaseSchema>;
export type Effort = Schema.Schema.Type<typeof PlanEffortSchema>;
export type PhaseMode = Schema.Schema.Type<typeof PhaseModeSchema>;
export type PhaseOracle = Schema.Schema.Type<typeof PhaseOracleSchema>;

/** `phax-plan.json` as phax writes it: `$schema` first, then the plan. Unknown keys are rejected. */
export const PhaxPlanFileSchema = Schema.Struct({
  $schema: schemaUrlField("phax-plan"),
  ...phaxPlanFields,
});

export type PhaxPlanFile = Schema.Schema.Type<typeof PhaxPlanFileSchema>;

export const decodePhaxPlanFile = Schema.decodeUnknownEither(PhaxPlanFileSchema, {
  onExcessProperty: "error",
});
export const encodePhaxPlanFile = Schema.encodeSync(PhaxPlanFileSchema);

/** The JSON Schema the extraction model is given: its answer, without `mode` and `oracle`. */
export function getExtractedPlanJsonSchema(): object {
  return JSONSchema.make(ExtractionAnswerSchema);
}
