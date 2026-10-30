import { Schema } from "effect";
import { NonEmptyString } from "./strictString.js";

// The questions a spec or plan document carries, in two states: open, or
// arbitrated with a verdict and the history of its earlier verdicts. A
// verdict is an explicit union: `decided` by the operator, or `lifted` from a
// document written before verdicts existed, which records only what that
// document carried and names no arbiter. Every key is required; the document
// decoders reject unknown keys. Shared by the spec and plan documents, phax's
// reader and the schemas package, so they agree on every check and every lift.

// A question or option id: a run of characters without whitespace, so the §9
// format's `### <id> — …`, `- <id> — …`, Recommendation and Decision lines
// read it back.
const QuestionIdSchema = Schema.String.pipe(
  Schema.pattern(/^\S+$/),
  Schema.annotations({ description: "An id: a run of characters without whitespace." }),
);

export const QuestionOptionSchema = Schema.Struct({
  id: QuestionIdSchema,
  label: NonEmptyString,
  abandons: NonEmptyString,
});

export const OpenQuestionSchema = Schema.Struct({
  id: QuestionIdSchema,
  question: NonEmptyString,
  options: Schema.Array(QuestionOptionSchema).pipe(Schema.minItems(2)),
  recommendation: NonEmptyString,
  rationale: NonEmptyString,
});

export type OpenQuestion = Schema.Schema.Type<typeof OpenQuestionSchema>;

const DateSchema = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.annotations({ description: "A date, YYYY-MM-DD." }),
);

const TimestampSchema = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
  Schema.annotations({ description: "An ISO-8601 UTC timestamp." }),
);

/**
 * A verdict lifted from a document written before verdicts existed: the
 * question's recommendation as `chosen`, its rationale as `why` and the
 * author's marker date as `at`. It names no arbiter.
 */
export const LiftedVerdictSchema = Schema.Struct({
  kind: Schema.Literal("lifted"),
  chosen: NonEmptyString,
  abandoned: Schema.Array(NonEmptyString),
  why: NonEmptyString,
  at: DateSchema,
  by: Schema.Struct({ kind: Schema.Literal("unattributed") }),
});

export type LiftedVerdict = Schema.Schema.Type<typeof LiftedVerdictSchema>;

const decidedVerdictFields = {
  kind: Schema.Literal("decided"),
  chosen: NonEmptyString,
  abandoned: Schema.Array(NonEmptyString),
  why: NonEmptyString,
  advocate: NonEmptyString,
  principles: Schema.Array(NonEmptyString),
  reversibility: Schema.Literal("cheap", "costly", "irreversible"),
  by: Schema.Struct({ kind: Schema.Literal("operator"), name: NonEmptyString }),
  at: TimestampSchema,
  revised: Schema.Array(NonEmptyString),
};

/** A spec question decided by the operator. */
export const SpecDecidedVerdictSchema = Schema.Struct(decidedVerdictFields);

/** A plan question decided by the operator: a spec's decided verdict, plus the phase it bears on. */
export const PlanDecidedVerdictSchema = Schema.Struct({
  ...decidedVerdictFields,
  phase: Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/)),
});

export const SpecVerdictSchema = Schema.Union(SpecDecidedVerdictSchema, LiftedVerdictSchema);
export const PlanVerdictSchema = Schema.Union(PlanDecidedVerdictSchema, LiftedVerdictSchema);

export type SpecVerdict = Schema.Schema.Type<typeof SpecVerdictSchema>;
export type PlanVerdict = Schema.Schema.Type<typeof PlanVerdictSchema>;

/** A spec question with its current verdict and its earlier ones, oldest first. */
export const SpecArbitratedQuestionSchema = Schema.Struct({
  ...OpenQuestionSchema.fields,
  verdict: SpecVerdictSchema,
  history: Schema.Array(SpecVerdictSchema),
});

/** A plan question with its current verdict and its earlier ones, oldest first. */
export const PlanArbitratedQuestionSchema = Schema.Struct({
  ...OpenQuestionSchema.fields,
  verdict: PlanVerdictSchema,
  history: Schema.Array(PlanVerdictSchema),
});

export type SpecArbitratedQuestion = Schema.Schema.Type<typeof SpecArbitratedQuestionSchema>;
export type PlanArbitratedQuestion = Schema.Schema.Type<typeof PlanArbitratedQuestionSchema>;

export const AUTHORING_ARBITRATED_MESSAGE =
  "an authoring session returns open questions only: arbitratedQuestions must be []";

/** A document-relative path and what is wrong there. */
export interface QuestionViolation {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

/**
 * An authoring answer's `arbitratedQuestions`, checked by phax rather than by
 * the schema (the answer is the published document, whose arbitrated questions
 * a sidecar carries): an authoring session leaves every question open, so a
 * non-empty array is refused at its first entry, `<basePath>.arbitratedQuestions[0]`.
 */
export function authoringArbitratedViolation(
  arbitratedQuestions: ReadonlyArray<unknown>,
  basePath: ReadonlyArray<PropertyKey>,
): QuestionViolation | undefined {
  return arbitratedQuestions.length === 0
    ? undefined
    : { path: [...basePath, "arbitratedQuestions", 0], message: AUTHORING_ARBITRATED_MESSAGE };
}

/** The two question arrays of a document, and where they sit in it. */
export interface QuestionArrays {
  /** The path of the object holding both arrays: `[]` for a spec, `["preamble"]` for a plan. */
  readonly basePath: ReadonlyArray<PropertyKey>;
  readonly openQuestions: ReadonlyArray<OpenQuestion>;
  readonly arbitratedQuestions: ReadonlyArray<SpecArbitratedQuestion | PlanArbitratedQuestion>;
  /** The document's phase ids, for a plan; null for a spec. */
  readonly phaseIds: ReadonlyArray<string> | null;
}

function render(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((key, i) =>
      typeof key === "number" ? `[${key}]` : i === 0 ? String(key) : `.${String(key)}`,
    )
    .join("");
}

/**
 * The reserved option id every question implicitly offers: a verdict that
 * chooses it names an answer the listed options do not. No question lists it
 * as an option or recommends it.
 */
export const OTHER_OPTION_ID = "other";

function optionList(question: OpenQuestion): string {
  return question.options.map((o) => o.id).join(", ");
}

// The ids a verdict may choose: the listed options and the reserved `other`.
function choosableList(question: OpenQuestion): string {
  return `${optionList(question)}, ${OTHER_OPTION_ID}`;
}

function firstVerdictViolation(
  question: OpenQuestion,
  verdict: SpecVerdict | PlanVerdict,
  path: ReadonlyArray<PropertyKey>,
): QuestionViolation | undefined {
  const optionIds = question.options.map((o) => o.id);
  if (verdict.chosen !== OTHER_OPTION_ID && !optionIds.includes(verdict.chosen)) {
    return {
      path: [...path, "chosen"],
      message: `"${verdict.chosen}" names none of the question's options (${choosableList(question)})`,
    };
  }
  const seen = new Set<string>();
  for (const [i, id] of verdict.abandoned.entries()) {
    if (id === verdict.chosen) {
      return { path: [...path, "abandoned", i], message: `"${id}" is the chosen option` };
    }
    if (!optionIds.includes(id)) {
      return {
        path: [...path, "abandoned", i],
        message: `"${id}" names none of the question's options (${optionList(question)})`,
      };
    }
    if (seen.has(id)) {
      return { path: [...path, "abandoned", i], message: `"${id}" is abandoned twice` };
    }
    seen.add(id);
  }
  const missing = optionIds.filter((id) => id !== verdict.chosen && !seen.has(id));
  if (missing.length > 0) {
    return {
      path: [...path, "abandoned"],
      message: `misses ${missing.map((id) => `"${id}"`).join(", ")}: a verdict abandons every option it does not choose`,
    };
  }
  return undefined;
}

/**
 * The first violation of the question checks, in a fixed order, so the
 * violation reported for a given document is stable:
 * 1. question ids are unique across both arrays (the later duplicate is named);
 * 2. option ids are unique within each question;
 * 3. no option has the reserved id `other`, and no recommendation is `other`;
 * 4. each question's `recommendation` names one of its options;
 * 5. each arbitrated question's verdict, and every verdict in its history,
 *    chooses one of its options, or the reserved `other`, and abandons
 *    exactly every other listed option, each once, in any order;
 * 6. on a plan, a current decided verdict's `phase` names one of its phases.
 * Paths are document-relative, for `formatFirstViolation`.
 */
export function firstQuestionViolation(arrays: QuestionArrays): QuestionViolation | undefined {
  const { basePath } = arrays;
  const located = [
    ...arrays.openQuestions.map((question, i) => ({
      question,
      path: [...basePath, "openQuestions", i] as ReadonlyArray<PropertyKey>,
    })),
    ...arrays.arbitratedQuestions.map((question, i) => ({
      question,
      path: [...basePath, "arbitratedQuestions", i] as ReadonlyArray<PropertyKey>,
    })),
  ];

  const firstAt = new Map<string, ReadonlyArray<PropertyKey>>();
  for (const { question, path } of located) {
    const seen = firstAt.get(question.id);
    if (seen !== undefined) {
      return {
        path: [...path, "id"],
        message: `"${question.id}" duplicates the question id at ${render(seen)}`,
      };
    }
    firstAt.set(question.id, path);
  }

  for (const { question, path } of located) {
    const firstIndex = new Map<string, number>();
    for (const [i, option] of question.options.entries()) {
      const seen = firstIndex.get(option.id);
      if (seen !== undefined) {
        return {
          path: [...path, "options", i, "id"],
          message: `"${option.id}" duplicates the option id at index ${seen}`,
        };
      }
      firstIndex.set(option.id, i);
    }
  }

  for (const { question, path } of located) {
    const reserved = question.options.findIndex((o) => o.id === OTHER_OPTION_ID);
    if (reserved !== -1) {
      return {
        path: [...path, "options", reserved, "id"],
        message: `${question.id} lists an option with the id "${OTHER_OPTION_ID}": "${OTHER_OPTION_ID}" is reserved and implicit on every question`,
      };
    }
    if (question.recommendation === OTHER_OPTION_ID) {
      return {
        path: [...path, "recommendation"],
        message: `${question.id} recommends "${OTHER_OPTION_ID}": "${OTHER_OPTION_ID}" is reserved and implicit on every question`,
      };
    }
  }

  for (const { question, path } of located) {
    if (!question.options.some((o) => o.id === question.recommendation)) {
      return {
        path: [...path, "recommendation"],
        message: `"${question.recommendation}" names none of the question's options (${optionList(question)})`,
      };
    }
  }

  for (const [q, question] of arrays.arbitratedQuestions.entries()) {
    const path = [...basePath, "arbitratedQuestions", q];
    const current = firstVerdictViolation(question, question.verdict, [...path, "verdict"]);
    if (current !== undefined) return current;
    for (const [h, earlier] of question.history.entries()) {
      const violation = firstVerdictViolation(question, earlier, [...path, "history", h]);
      if (violation !== undefined) return violation;
    }
  }

  const { phaseIds } = arrays;
  if (phaseIds !== null) {
    for (const [q, { verdict }] of arrays.arbitratedQuestions.entries()) {
      if (verdict.kind === "decided" && "phase" in verdict && !phaseIds.includes(verdict.phase)) {
        return {
          path: [...basePath, "arbitratedQuestions", q, "verdict", "phase"],
          message: `"${verdict.phase}" names none of the plan's phases (${phaseIds.join(", ")})`,
        };
      }
    }
  }

  return undefined;
}

/** The JSON Schema description of the question checks a document's decoder runs. */
export const QUESTION_CHECKS_DESCRIPTION =
  "question ids are unique across openQuestions and arbitratedQuestions, and each question's option ids are unique; no option has the id `other` and no `recommendation` is `other`, because `other` is reserved and implicit on every question; each question's `recommendation` names one of its options; and each arbitrated question's verdict, and every verdict in its history, has `chosen` name one of its options or the reserved `other`, and `abandoned` hold exactly the other listed options, each once (every listed option when `chosen` is `other`)";

const MARKER = /^Decided by the author on (\d{4}-\d{2}-\d{2})/;

/**
 * Lifts the questions of a spec document written before verdicts existed.
 * A question whose `rationale` opens with `Decided by the author on
 * <YYYY-MM-DD>` (case-sensitive, untrimmed) is arbitrated with a lifted
 * verdict: its recommendation as `chosen`, its other options in option order
 * as `abandoned`, its rationale as `why`, the marker's date as `at`, and no
 * arbiter. Every other question stays open. Both keep their order. The
 * `question` text is never read.
 */
export function liftMarkedQuestions(openQuestions: ReadonlyArray<OpenQuestion>): {
  readonly openQuestions: ReadonlyArray<OpenQuestion>;
  readonly arbitratedQuestions: ReadonlyArray<SpecArbitratedQuestion>;
} {
  const open: OpenQuestion[] = [];
  const arbitrated: SpecArbitratedQuestion[] = [];
  for (const question of openQuestions) {
    const date = MARKER.exec(question.rationale)?.[1];
    if (date === undefined) {
      open.push(question);
      continue;
    }
    arbitrated.push({
      ...question,
      verdict: {
        kind: "lifted",
        chosen: question.recommendation,
        abandoned: question.options.map((o) => o.id).filter((id) => id !== question.recommendation),
        why: question.rationale,
        at: date,
        by: { kind: "unattributed" },
      },
      history: [],
    });
  }
  return { openQuestions: open, arbitratedQuestions: arbitrated };
}
