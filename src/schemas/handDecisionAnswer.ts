// The `hand-decision-answer` document a decide session returns, as its final
// message, for a hand-authored spec or plan: an artifact with no sidecar for
// the session to revise. It carries the verdicts decided in the session, by
// question id, and the artifact's whole revised Markdown. phax keeps only the
// Markdown's edits outside the frontmatter, the question sections and the
// decision log, and writes those itself. Born with `$schema`; phax reads it
// through the bridge (`decodeCurrentHandDecisionAnswer`) and never writes one.
import { JSONSchema, Schema } from "effect";
import { PlanDecidedVerdictSchema, SpecDecidedVerdictSchema } from "./questions.js";
import { schemaUrlField } from "./schemaUrl.js";

// A question id, as the §9 format reads it back: no whitespace.
const QuestionIdSchema = Schema.String.pipe(
  Schema.pattern(/^\S+$/),
  Schema.annotations({ description: "A question id of the artifact: no whitespace." }),
);

const MarkdownSchema = Schema.NonEmptyString.annotations({
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

const SpecHandDecisionAnswerFileSchema = Schema.Struct({
  $schema: schemaUrlField("hand-decision-answer"),
  kind: Schema.Literal("spec"),
  decisions: Schema.Array(SpecHandDecisionSchema).annotations({
    description: "The verdicts decided in the session, one per question id; empty when none.",
  }),
  markdown: MarkdownSchema,
});

const PlanHandDecisionAnswerFileSchema = Schema.Struct({
  $schema: schemaUrlField("hand-decision-answer"),
  kind: Schema.Literal("plan"),
  decisions: Schema.Array(PlanHandDecisionSchema).annotations({
    description:
      "The verdicts decided in the session, one per question id, each naming the plan phase it bears on; empty when none.",
  }),
  markdown: MarkdownSchema,
});

/**
 * A `hand-decision-answer` document: `$schema`, then the keys of one kind.
 * Every key is required; any other key is refused, at any level.
 */
export const HandDecisionAnswerFileSchema = Schema.Union(
  SpecHandDecisionAnswerFileSchema,
  PlanHandDecisionAnswerFileSchema,
);

export type HandDecisionAnswerFile = Schema.Schema.Type<typeof HandDecisionAnswerFileSchema>;

type WithoutSchema<T> = T extends unknown ? Omit<T, "$schema"> : never;

/** A hand decision answer, without `$schema`: a spec's or a plan's. */
export type HandDecisionAnswer = WithoutSchema<HandDecisionAnswerFile>;

/** One decided verdict of a hand decision answer. */
export type HandDecision = HandDecisionAnswer["decisions"][number];

export const decodeHandDecisionAnswerFile = Schema.decodeUnknownEither(
  HandDecisionAnswerFileSchema,
  { onExcessProperty: "error" },
);

/** The JSON Schema of a hand decision answer: what a decide session returns for a hand-authored artifact. */
export function getHandDecisionAnswerFileJsonSchema(): object {
  return JSONSchema.make(HandDecisionAnswerFileSchema);
}
