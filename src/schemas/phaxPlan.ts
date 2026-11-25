import { Schema, type Types } from "effect";
import { PlanPath, PlanPathFromWritten } from "./planPath.js";
import { schemaUrlField } from "./schemaUrl.js";
import { NonEmptyString, isExportedPattern } from "./strictString.js";
import { TestLineSchema } from "./testLine.js";

/** phax's effort vocabulary: a plan phase's `effort`, and a bound's `effort.min` and `effort.max`. */
export const PlanEffortSchema = Schema.Literals([
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

/** How a phase runs: headless, or kept open for a person (interactive-phases). */
export const PhaseModeSchema = Schema.Literals(["headless", "interactive"]);

const PhaseIdSchema = Schema.String.check(isExportedPattern(/^phase-\d{2}$/));

/**
 * A phase's acceptance tests (acceptance-tests): the phase that passes them and
 * the acceptance test files it pins, or null. An empty `files` list is admitted
 * here: whether a plan's acceptance pair is well formed beyond its shape is a
 * lint rule.
 */
const PhaseAcceptanceSchema = Schema.NullOr(
  Schema.Struct({
    passedBy: PhaseIdSchema,
    files: Schema.Array(NonEmptyString),
  }),
);

// The fields of an extracted phase. `title` is deliberately absent: it is
// derived deterministically from the plan.md heading (see `finalizeExtractedPlan`),
// not round-tripped through the model's JSON. A `"` in a title would otherwise
// derail the model into malformed output, which the strict `onExcessProperty`
// decode rejects — keeping the trip-wire but removing the failure mode.
// `mode` and `acceptance` are phax's own reading of the phase's header lines in
// plan.md (`phaseKinds`), as the title is its reading of the heading, so the
// model's answer (`ExtractionAnswerSchema`) leaves them out too. `testLines`
// are extracted on both paths: the deterministic parser reads the phase's
// `### Test strategy` section, and the model emits them through the same
// `TestLineSchema`.
// The fields are exported on their own so the plan document (planDocument.ts)
// carries exactly these schemas rather than a copy that could drift. The three
// file lists hold canonical plan paths only (`PlanPath`): every reader then
// compares the strings git reports, normalizing nothing itself.
export const ExtractedPhaseFields = {
  id: PhaseIdSchema,
  model: NonEmptyString,
  effort: PlanEffortSchema,
  planMarkdownAnchor: NonEmptyString,
  plannedFilesToCreate: Schema.Array(PlanPath),
  plannedFilesToEdit: Schema.Array(PlanPath),
  optionalFilesToEdit: Schema.Array(PlanPath),
  mode: PhaseModeSchema,
  acceptance: PhaseAcceptanceSchema,
  testLines: Schema.Array(TestLineSchema),
  commit: Schema.Struct({
    subject: NonEmptyString,
    body: NonEmptyString,
  }),
};

const ExtractedPhaseSchema = Schema.Struct(ExtractedPhaseFields);

// What the extraction model emits per phase: the extracted fields, test lines
// included, without the two phax reads from the header lines. The
// phax-plan-extraction answer (planExtraction.ts) carries exactly these. Its
// three file lists admit any plannable spelling and decode to its canonical
// form (`PlanPathFromWritten`): the model may answer `./src/x.ts`, and phax
// reads `src/x.ts`.
const { mode: _mode, acceptance: _acceptance, ...answerPhaseFieldsRest } = ExtractedPhaseFields;
export const answerPhaseFields = {
  ...answerPhaseFieldsRest,
  plannedFilesToCreate: Schema.Array(PlanPathFromWritten),
  plannedFilesToEdit: Schema.Array(PlanPathFromWritten),
  optionalFilesToEdit: Schema.Array(PlanPathFromWritten),
};

/**
 * A gate profile id as a plan declares it: a non-empty run of non-whitespace
 * characters without a backtick, so the plan's `## Gate profile` section reads
 * it back from a code span or a bare word. One pattern, which also refuses the
 * empty string, carrying the description: a second check would render under
 * `allOf`, outside a provider's strict structured output.
 */
const GateProfileId = Schema.String.check(
  isExportedPattern(/^[^\s`]+$/, {
    message: "a gate profile id is a run of non-whitespace characters holding no backtick",
    description:
      "The id of the one gate profile in phax.json that verifies this plan's whole run; rendered as the plan's `## Gate profile` section.",
  }),
);

// What the extraction model emits for the run: the extracted run without the
// declared gate profile, which phax reads from plan.md's `## Gate profile`
// section itself (`readPlanGateProfile`), as it reads a phase's mode and
// acceptance. The phax-plan-extraction answer (planExtraction.ts) carries
// exactly these.
export const answerRunFields = {
  // Loose on purpose: the model is unreliable at emitting a valid slug, so we
  // accept any non-empty string here and slugify it ourselves in
  // `finalizeExtractedPlan` (see `slugifyShortName`).
  shortName: NonEmptyString,
  title: NonEmptyString,
  requiredCommands: Schema.Array(Schema.String),
};

export const ExtractedRunSchema = Schema.Struct({
  ...answerRunFields,
  gateProfile: GateProfileId,
});

// The persisted phase: the extracted fields plus the heading-derived `title`.
const PhaseSchema = Schema.Struct({
  id: ExtractedPhaseFields.id,
  title: NonEmptyString,
  model: ExtractedPhaseFields.model,
  effort: ExtractedPhaseFields.effort,
  planMarkdownAnchor: ExtractedPhaseFields.planMarkdownAnchor,
  plannedFilesToCreate: ExtractedPhaseFields.plannedFilesToCreate,
  plannedFilesToEdit: ExtractedPhaseFields.plannedFilesToEdit,
  optionalFilesToEdit: ExtractedPhaseFields.optionalFilesToEdit,
  mode: ExtractedPhaseFields.mode,
  acceptance: ExtractedPhaseFields.acceptance,
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

// The full plan, after phax merges in the deterministic fields.
const phaxPlanFields = {
  run: Schema.Struct({
    shortName: NonEmptyString,
    title: NonEmptyString,
    branch: NonEmptyString,
    requiredCommands: Schema.Array(Schema.String),
    gateProfile: GateProfileId,
  }),
  phases: Schema.NonEmptyArray(PhaseSchema),
};

export type ExtractedPhaxPlan = Schema.Schema.Type<typeof ExtractedPhaxPlanSchema>;
/** A run's plan in memory: never a `version`, never a `$schema`. */
export type PhaxPlan = Types.Simplify<Schema.Struct.Type<typeof phaxPlanFields>>;
export type PhaxPlanPhase = Schema.Schema.Type<typeof PhaseSchema>;
export type Effort = Schema.Schema.Type<typeof PlanEffortSchema>;
export type PhaseMode = Schema.Schema.Type<typeof PhaseModeSchema>;
export type PhaseAcceptance = Schema.Schema.Type<typeof PhaseAcceptanceSchema>;

/** `phax-plan.json` as phax writes it: `$schema` first, then the plan. Unknown keys are rejected. */
export const PhaxPlanFileSchema = Schema.Struct({
  $schema: schemaUrlField("phax-plan"),
  ...phaxPlanFields,
});

export type PhaxPlanFile = Schema.Schema.Type<typeof PhaxPlanFileSchema>;

export const decodePhaxPlanFile = Schema.decodeUnknownResult(PhaxPlanFileSchema, {
  onExcessProperty: "error",
  reportInput: true,
});
export const encodePhaxPlanFile = Schema.encodeSync(PhaxPlanFileSchema);
