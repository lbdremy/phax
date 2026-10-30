// The answer a decide session returns for a hand-authored spec or plan: the
// hand decision answer, its verdicts by question id and the artifact's revised
// Markdown; and the verdicts file a person writes for `phax artifact decide
// --verdicts`. Each format's current shape, named by `CURRENT_SHAPES` (`next`
// until a release renames it), is phax's own file schema and decoder. The
// package declares none of its own.
import {
  DecideVerdictsFileSchema,
  decodeDecideVerdictsFile,
  type DecideVerdicts,
  type DecideVerdictsFile,
} from "../../../../src/schemas/decideVerdicts.js";
import {
  HandDecisionAnswerFileSchema,
  decodeHandDecisionAnswerFile,
  type HandDecisionAnswer,
  type HandDecisionAnswerFile,
} from "../../../../src/schemas/handDecisionAnswer.js";
import {
  PlanExtractionAnswerSchema,
  decodePlanExtractionAnswer,
  type PlanExtractionAnswer,
} from "../../../../src/schemas/planExtraction.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat, type CurrentShapeName } from "../shapes.js";

// Born with `$schema`: no pre-schema shape, and a document without `$schema`
// is unreadable. It refuses a key it does not name, at any level. The latest
// value is phax's in-memory value, with no `$schema`.

export type HandDecisionAnswerShapes = {
  [K in CurrentShapeName<"hand-decision-answer">]: HandDecisionAnswerFile;
};

/** The id of every hand decision answer shape the package reads. */
export type HandDecisionAnswerShape = keyof HandDecisionAnswerShapes;

export const handDecisionAnswerFormat = defineFormat<HandDecisionAnswerShapes>({
  id: "hand-decision-answer",
  label: "hand decision answer",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["hand-decision-answer"],
    shape: { schema: HandDecisionAnswerFileSchema, decode: decodeHandDecisionAnswerFile },
  },
});

/**
 * Reads a hand decision answer: the final message of a decide session over a
 * hand-authored spec or plan. Never throws.
 */
export const parseHandDecisionAnswer: (input: unknown) => ParsedShape<HandDecisionAnswerShapes> =
  handDecisionAnswerFormat.parse;

/** The latest hand decision answer: phax's in-memory value, with no `$schema`. */
export type LatestHandDecisionAnswer = HandDecisionAnswer;

/** Upgrades a parsed hand decision answer in memory: drops `$schema`, keeps every other fact. */
export function toLatestHandDecisionAnswer(
  value: HandDecisionAnswerFile,
): LatestHandDecisionAnswer {
  const { $schema: _schema, ...answer } = value;
  return answer;
}

// ── decide verdicts

// Born with `$schema`: no pre-schema shape, and a file without `$schema` is
// unreadable. It refuses a key it does not name, at any level. The latest
// value is phax's in-memory value, with no `$schema`.

export type DecideVerdictsShapes = {
  [K in CurrentShapeName<"decide-verdicts">]: DecideVerdictsFile;
};

/** The id of every decide verdicts shape the package reads. */
export type DecideVerdictsShape = keyof DecideVerdictsShapes;

export const decideVerdictsFormat = defineFormat<DecideVerdictsShapes>({
  id: "decide-verdicts",
  label: "decide verdicts",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["decide-verdicts"],
    shape: { schema: DecideVerdictsFileSchema, decode: decodeDecideVerdictsFile },
  },
});

/**
 * Reads a decide verdicts file: the decisions a person has already made, for
 * `phax artifact decide --verdicts`. Never throws.
 */
export const parseDecideVerdicts: (input: unknown) => ParsedShape<DecideVerdictsShapes> =
  decideVerdictsFormat.parse;

/** The latest decide verdicts: phax's in-memory value, with no `$schema`. */
export type LatestDecideVerdicts = DecideVerdicts;

/** Upgrades parsed decide verdicts in memory: drops `$schema`, keeps every other fact. */
export function toLatestDecideVerdicts(value: DecideVerdictsFile): LatestDecideVerdicts {
  const { $schema: _schema, ...verdicts } = value;
  return verdicts;
}

// ── plan extraction

// Born at 0.32.0 with `$schema`: no pre-schema shape and no earlier release,
// and a document without `$schema` is unreadable. It refuses a key it does not
// name, at any level. The latest value is phax's in-memory value, with no
// `$schema`. A const `$schema` reads only its own stamp: a document stamped
// above the format's current stamp (and at or below the package's release) is
// refused at `$schema`, and phax never writes one.

export type PhaxPlanExtractionShapes = {
  [K in CurrentShapeName<"phax-plan-extraction">]: PlanExtractionAnswer;
};

/** The id of every plan extraction shape the package reads. */
export type PhaxPlanExtractionShape = keyof PhaxPlanExtractionShapes;

export const phaxPlanExtractionFormat = defineFormat<PhaxPlanExtractionShapes>({
  id: "phax-plan-extraction",
  label: "plan extraction",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["phax-plan-extraction"],
    shape: { schema: PlanExtractionAnswerSchema, decode: decodePlanExtractionAnswer },
  },
});

/**
 * Reads the answer the fallback extraction model gave for a plan.md: the
 * extracted plan, or why the plan is incomplete. Never throws.
 */
export const parsePhaxPlanExtraction: (input: unknown) => ParsedShape<PhaxPlanExtractionShapes> =
  phaxPlanExtractionFormat.parse;

/** The latest plan extraction: phax's in-memory value, with no `$schema`. */
export type LatestPhaxPlanExtraction = Omit<PlanExtractionAnswer, "$schema">;

/** Upgrades a parsed plan extraction in memory: drops `$schema`, keeps the plan and the reason. */
export function toLatestPhaxPlanExtraction(value: PlanExtractionAnswer): LatestPhaxPlanExtraction {
  const { $schema: _schema, ...answer } = value;
  return answer;
}
