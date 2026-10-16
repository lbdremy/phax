// The answer a decide session returns for a hand-authored spec or plan: the
// hand decision answer, its verdicts by question id and the artifact's revised
// Markdown. Its current shape, named by `CURRENT_SHAPES` (`next` until a
// release renames it), is phax's own file schema and decoder. The package
// declares none of its own.
import {
  HandDecisionAnswerFileSchema,
  decodeHandDecisionAnswerFile,
  type HandDecisionAnswer,
  type HandDecisionAnswerFile,
} from "../../../../src/schemas/handDecisionAnswer.js";
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
