// The answer a decide session returns for a hand-authored spec or plan: since
// 0.32.0 one format per kind, the spec and the plan hand decision answer, each
// its verdicts by question id and the artifact's revised Markdown; the retired
// hand decision answer, their 0.25.0 root union; and the verdicts file a person
// writes for `phax artifact decide --verdicts`. Each format's current shape,
// named by `CURRENT_SHAPES` (`next` until a release renames it), is phax's own
// file schema and decoder, or, for the retired format, its frozen module. The
// package declares none of its own.
import {
  DecideVerdictsFileSchema,
  decodeDecideVerdictsFile,
  type DecideVerdicts,
  type DecideVerdictsFile,
} from "../../../../src/schemas/decideVerdicts.js";
import {
  PlanHandDecisionAnswerFileSchema,
  SpecHandDecisionAnswerFileSchema,
  decodePlanHandDecisionAnswerFile,
  decodeSpecHandDecisionAnswerFile,
  type PlanHandDecisionAnswer,
  type PlanHandDecisionAnswerFile,
  type SpecHandDecisionAnswer,
  type SpecHandDecisionAnswerFile,
} from "../../../../src/schemas/handDecisionAnswer.js";
import {
  HandDecisionAnswerV0_25_0Schema,
  decodeHandDecisionAnswerV0_25_0,
  type HandDecisionAnswerV0_25_0,
} from "../../../../src/schemas/history/hand-decision-answer/0.25.0.js";
import {
  PlanExtractionAnswerSchema,
  decodePlanExtractionAnswer,
  type PlanExtractionAnswer,
} from "../../../../src/schemas/planExtraction.js";
import { CURRENT_SHAPES } from "../generated/index.js";
import type { ParsedShape } from "../parsed.js";
import { defineFormat, type CurrentShapeName } from "../shapes.js";

// ── hand decision answer, retired

// Born with `$schema`: no pre-schema shape, and a document without `$schema`
// is unreadable. It refuses a key it does not name, at any level. Retired at
// 0.32.0 for the spec and plan hand decision answers: its 0.25.0 root union is
// frozen, listed as its 0.25.0 release and as its current shape, so the
// package still reads one. phax never wrote one and reads it nowhere. The
// latest value is the union, with no `$schema`.

export type HandDecisionAnswerShapes = {
  "0.25.0": HandDecisionAnswerV0_25_0;
} & {
  [K in CurrentShapeName<"hand-decision-answer">]: HandDecisionAnswerV0_25_0;
};

/** The id of every hand decision answer shape the package reads. */
export type HandDecisionAnswerShape = keyof HandDecisionAnswerShapes;

const handDecisionAnswerV0_25_0 = {
  schema: HandDecisionAnswerV0_25_0Schema,
  decode: decodeHandDecisionAnswerV0_25_0,
};

export const handDecisionAnswerFormat = defineFormat<HandDecisionAnswerShapes>({
  id: "hand-decision-answer",
  label: "hand decision answer",
  preSchema: null,
  releases: [["0.25.0", handDecisionAnswerV0_25_0]],
  current: {
    name: CURRENT_SHAPES["hand-decision-answer"],
    shape: handDecisionAnswerV0_25_0,
  },
});

/**
 * Reads a hand decision answer: the final message a decide session over a
 * hand-authored spec or plan gave before 0.32.0. Never throws.
 */
export const parseHandDecisionAnswer: (input: unknown) => ParsedShape<HandDecisionAnswerShapes> =
  handDecisionAnswerFormat.parse;

type WithoutSchema<T> = T extends unknown ? Omit<T, "$schema"> : never;

/** The latest hand decision answer: its spec or plan variant, with no `$schema`. */
export type LatestHandDecisionAnswer = WithoutSchema<HandDecisionAnswerV0_25_0>;

/** Upgrades a parsed hand decision answer in memory: drops `$schema`, keeps every other fact. */
export function toLatestHandDecisionAnswer(
  value: HandDecisionAnswerV0_25_0,
): LatestHandDecisionAnswer {
  const { $schema: _schema, ...answer } = value;
  return answer;
}

// ── spec hand decision answer

// Born at 0.32.0 with `$schema`: no pre-schema shape and no earlier release,
// and a document without `$schema` is unreadable. It refuses a key it does
// not name, at any level, a verdict's `phase` among them. A const `$schema`
// reads only its own stamp. The latest value is phax's in-memory value, with
// no `$schema`.

export type SpecHandDecisionAnswerShapes = {
  [K in CurrentShapeName<"spec-hand-decision-answer">]: SpecHandDecisionAnswerFile;
};

/** The id of every spec hand decision answer shape the package reads. */
export type SpecHandDecisionAnswerShape = keyof SpecHandDecisionAnswerShapes;

export const specHandDecisionAnswerFormat = defineFormat<SpecHandDecisionAnswerShapes>({
  id: "spec-hand-decision-answer",
  label: "spec hand decision answer",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["spec-hand-decision-answer"],
    shape: {
      schema: SpecHandDecisionAnswerFileSchema,
      decode: decodeSpecHandDecisionAnswerFile,
    },
  },
});

/**
 * Reads a spec hand decision answer: the final message of a decide session
 * over a hand-authored spec. Never throws.
 */
export const parseSpecHandDecisionAnswer: (
  input: unknown,
) => ParsedShape<SpecHandDecisionAnswerShapes> = specHandDecisionAnswerFormat.parse;

/** The latest spec hand decision answer: phax's in-memory value, with no `$schema`. */
export type LatestSpecHandDecisionAnswer = SpecHandDecisionAnswer;

/** Upgrades a parsed spec hand decision answer in memory: drops `$schema`, keeps every other fact. */
export function toLatestSpecHandDecisionAnswer(
  value: SpecHandDecisionAnswerFile,
): LatestSpecHandDecisionAnswer {
  const { $schema: _schema, ...answer } = value;
  return answer;
}

// ── plan hand decision answer

// Born at 0.32.0 with `$schema`, as the spec hand decision answer; each
// verdict names the plan phase it bears on.

export type PlanHandDecisionAnswerShapes = {
  [K in CurrentShapeName<"plan-hand-decision-answer">]: PlanHandDecisionAnswerFile;
};

/** The id of every plan hand decision answer shape the package reads. */
export type PlanHandDecisionAnswerShape = keyof PlanHandDecisionAnswerShapes;

export const planHandDecisionAnswerFormat = defineFormat<PlanHandDecisionAnswerShapes>({
  id: "plan-hand-decision-answer",
  label: "plan hand decision answer",
  preSchema: null,
  releases: [],
  current: {
    name: CURRENT_SHAPES["plan-hand-decision-answer"],
    shape: {
      schema: PlanHandDecisionAnswerFileSchema,
      decode: decodePlanHandDecisionAnswerFile,
    },
  },
});

/**
 * Reads a plan hand decision answer: the final message of a decide session
 * over a hand-authored plan. Never throws.
 */
export const parsePlanHandDecisionAnswer: (
  input: unknown,
) => ParsedShape<PlanHandDecisionAnswerShapes> = planHandDecisionAnswerFormat.parse;

/** The latest plan hand decision answer: phax's in-memory value, with no `$schema`. */
export type LatestPlanHandDecisionAnswer = PlanHandDecisionAnswer;

/** Upgrades a parsed plan hand decision answer in memory: drops `$schema`, keeps every other fact. */
export function toLatestPlanHandDecisionAnswer(
  value: PlanHandDecisionAnswerFile,
): LatestPlanHandDecisionAnswer {
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
