// The answer a decide session returns, as its final message, for a
// hand-authored spec or plan: an artifact with no sidecar for the session to
// revise. It carries the verdicts decided in the session, by question id, and
// the artifact's whole revised Markdown. phax keeps only the Markdown's edits
// outside the frontmatter, the question sections and the decision log, and
// writes those itself. Two formats, one per kind, each a closed object with a
// `$schema` const, born at 0.32.0: `spec-hand-decision-answer`, whose decided
// verdicts have no `phase`, and `plan-hand-decision-answer`, whose verdicts
// name the phase they bear on. `kind` stays, a one-value literal, so the
// in-memory union is unchanged. They replace `hand-decision-answer`'s root
// union, frozen at 0.25.0 (src/schemas/history/hand-decision-answer/0.25.0.ts).
// phax reads them through the bridge (`decodeCurrentHandDecisionAnswer`) and
// never writes one.
import { Schema } from "effect";
import { answerSchemaUrlField } from "./answerStamp.js";
import { PlanDecidedVerdictSchema, SpecDecidedVerdictSchema } from "./questions.js";
import { NonEmptyString } from "./strictString.js";

// A question id, as the §9 format reads it back: no whitespace.
const QuestionIdSchema = Schema.String.pipe(
  Schema.pattern(/^\S+$/),
  Schema.annotations({ description: "A question id of the artifact: no whitespace." }),
);

const MarkdownSchema = NonEmptyString.annotations({
  description:
    "The artifact's whole revised Markdown, frontmatter included. Only edits outside the frontmatter, the question sections and the decision log are kept; phax writes those.",
});

const SpecHandDecisionSchema = Schema.Struct({
  id: QuestionIdSchema,
  verdict: SpecDecidedVerdictSchema,
});

const PlanHandDecisionSchema = Schema.Struct({
  id: QuestionIdSchema,
  verdict: PlanDecidedVerdictSchema,
});

/**
 * A `spec-hand-decision-answer` document: `$schema`, `kind: "spec"`, the
 * decided verdicts (no `phase`) and the Markdown. Every key is required; any
 * other key is refused, at any level.
 */
export const SpecHandDecisionAnswerFileSchema = Schema.Struct({
  $schema: answerSchemaUrlField("spec-hand-decision-answer"),
  kind: Schema.Literal("spec"),
  decisions: Schema.Array(SpecHandDecisionSchema).annotations({
    description: "The verdicts decided in the session, one per question id; empty when none.",
  }),
  markdown: MarkdownSchema,
});

/**
 * A `plan-hand-decision-answer` document: `$schema`, `kind: "plan"`, the
 * decided verdicts, each naming its phase, and the Markdown. Every key is
 * required; any other key is refused, at any level.
 */
export const PlanHandDecisionAnswerFileSchema = Schema.Struct({
  $schema: answerSchemaUrlField("plan-hand-decision-answer"),
  kind: Schema.Literal("plan"),
  decisions: Schema.Array(PlanHandDecisionSchema).annotations({
    description:
      "The verdicts decided in the session, one per question id, each naming the plan phase it bears on; empty when none.",
  }),
  markdown: MarkdownSchema,
});

export type SpecHandDecisionAnswerFile = Schema.Schema.Type<
  typeof SpecHandDecisionAnswerFileSchema
>;
export type PlanHandDecisionAnswerFile = Schema.Schema.Type<
  typeof PlanHandDecisionAnswerFileSchema
>;

/** A spec hand decision answer, without `$schema`. */
export type SpecHandDecisionAnswer = Omit<SpecHandDecisionAnswerFile, "$schema">;
/** A plan hand decision answer, without `$schema`. */
export type PlanHandDecisionAnswer = Omit<PlanHandDecisionAnswerFile, "$schema">;

/** A hand decision answer, without `$schema`: a spec's or a plan's. */
export type HandDecisionAnswer = SpecHandDecisionAnswer | PlanHandDecisionAnswer;

/** One decided verdict of a hand decision answer. */
export type HandDecision = HandDecisionAnswer["decisions"][number];

export const decodeSpecHandDecisionAnswerFile = Schema.decodeUnknownEither(
  SpecHandDecisionAnswerFileSchema,
  { onExcessProperty: "error" },
);

export const decodePlanHandDecisionAnswerFile = Schema.decodeUnknownEither(
  PlanHandDecisionAnswerFileSchema,
  { onExcessProperty: "error" },
);
