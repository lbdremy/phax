// The frozen 0.25.0 shape of `hand-decision-answer`: the answer a decide
// session over a hand-authored spec or plan gave from phax 0.25.0 to 0.31.0,
// `$schema` first (a release pattern, not a const), then the keys of one kind,
// a root union of a spec and a plan variant. Retired at 0.32.0 for
// spec-hand-decision-answer and plan-hand-decision-answer: phax never wrote
// one and decodes it nowhere. Never edit this module:
// packages/schemas/history.lock.json pins its bytes. The schemas package lists
// it as the format's 0.25.0 release and as its current shape. It carries its
// own copy of the verdict schemas, so a later change to
// src/schemas/questions.ts cannot move it.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/hand-decision-answer\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The hand-decision-answer format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/hand-decision-answer/<X.Y.Z>.json",
  }),
);

const TimestampSchema = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
  Schema.annotations({ description: "An ISO-8601 UTC timestamp." }),
);

const decidedVerdictFields = {
  kind: Schema.Literal("decided"),
  chosen: Schema.NonEmptyString,
  abandoned: Schema.Array(Schema.NonEmptyString),
  why: Schema.NonEmptyString,
  advocate: Schema.NonEmptyString,
  principles: Schema.Array(Schema.NonEmptyString),
  reversibility: Schema.Literal("cheap", "costly", "irreversible"),
  by: Schema.Struct({ kind: Schema.Literal("operator"), name: Schema.NonEmptyString }),
  at: TimestampSchema,
  revised: Schema.Array(Schema.NonEmptyString),
};

/** A spec question decided by the operator. */
const SpecDecidedVerdictSchema = Schema.Struct(decidedVerdictFields);

/** A plan question decided by the operator: a spec's decided verdict, plus the phase it bears on. */
const PlanDecidedVerdictSchema = Schema.Struct({
  ...decidedVerdictFields,
  phase: Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/)),
});

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

const SpecHandDecisionAnswerSchema = Schema.Struct({
  $schema: SchemaUrlSchema,
  kind: Schema.Literal("spec"),
  decisions: Schema.Array(SpecHandDecisionSchema).annotations({
    description: "The verdicts decided in the session, one per question id; empty when none.",
  }),
  markdown: MarkdownSchema,
});

const PlanHandDecisionAnswerSchema = Schema.Struct({
  $schema: SchemaUrlSchema,
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
export const HandDecisionAnswerV0_25_0Schema = Schema.Union(
  SpecHandDecisionAnswerSchema,
  PlanHandDecisionAnswerSchema,
);

export type HandDecisionAnswerV0_25_0 = Schema.Schema.Type<typeof HandDecisionAnswerV0_25_0Schema>;

export const decodeHandDecisionAnswerV0_25_0 = Schema.decodeUnknownEither(
  HandDecisionAnswerV0_25_0Schema,
  { onExcessProperty: "error" },
);
