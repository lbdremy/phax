// The frozen 0.25.0 shape of `spec-document`: the sidecar phax 0.25.0 and
// 0.26.0 wrote, `$schema` first, surface elements `{ surface, binding, before,
// after }` with no summary, and its questions open or arbitrated. Never edit
// this module: packages/schemas/history.lock.json pins its bytes. In phax, only
// src/schemas/persisted.ts may import it. The schemas package lists it as the
// format's 0.25.0 release. It carries its own copy of the question schemas and
// checks, so a later change to src/schemas/questions.ts cannot move it.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/spec-document\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The spec-document format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/spec-document/<X.Y.Z>.json",
  }),
);

// A question or option id: a run of characters without whitespace, so the §9
// format's `### <id> — …`, `- <id> — …`, Recommendation and Decision lines
// read it back.
const QuestionIdSchema = Schema.String.pipe(
  Schema.pattern(/^\S+$/),
  Schema.annotations({ description: "An id: a run of characters without whitespace." }),
);

const QuestionOptionSchema = Schema.Struct({
  id: QuestionIdSchema,
  label: Schema.NonEmptyString,
  abandons: Schema.NonEmptyString,
});

const OpenQuestionSchema = Schema.Struct({
  id: QuestionIdSchema,
  question: Schema.NonEmptyString,
  options: Schema.Array(QuestionOptionSchema).pipe(Schema.minItems(2)),
  recommendation: Schema.NonEmptyString,
  rationale: Schema.NonEmptyString,
});

type OpenQuestion = Schema.Schema.Type<typeof OpenQuestionSchema>;

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
const LiftedVerdictSchema = Schema.Struct({
  kind: Schema.Literal("lifted"),
  chosen: Schema.NonEmptyString,
  abandoned: Schema.Array(Schema.NonEmptyString),
  why: Schema.NonEmptyString,
  at: DateSchema,
  by: Schema.Struct({ kind: Schema.Literal("unattributed") }),
});

/** A spec question decided by the operator. */
const SpecDecidedVerdictSchema = Schema.Struct({
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
});

const SpecVerdictSchema = Schema.Union(SpecDecidedVerdictSchema, LiftedVerdictSchema);

type SpecVerdict = Schema.Schema.Type<typeof SpecVerdictSchema>;

/** A spec question with its current verdict and its earlier ones, oldest first. */
const SpecArbitratedQuestionSchema = Schema.Struct({
  ...OpenQuestionSchema.fields,
  verdict: SpecVerdictSchema,
  history: Schema.Array(SpecVerdictSchema),
});

type SpecArbitratedQuestion = Schema.Schema.Type<typeof SpecArbitratedQuestionSchema>;

/** A document-relative path and what is wrong there. */
interface Violation {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

function render(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((key, i) =>
      typeof key === "number" ? `[${key}]` : i === 0 ? String(key) : `.${String(key)}`,
    )
    .join("");
}

function optionList(question: OpenQuestion): string {
  return question.options.map((o) => o.id).join(", ");
}

function firstVerdictViolation(
  question: OpenQuestion,
  verdict: SpecVerdict,
  path: ReadonlyArray<PropertyKey>,
): Violation | undefined {
  const optionIds = question.options.map((o) => o.id);
  if (!optionIds.includes(verdict.chosen)) {
    return {
      path: [...path, "chosen"],
      message: `"${verdict.chosen}" names none of the question's options (${optionList(question)})`,
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
 * 3. each question's `recommendation` names one of its options;
 * 4. each arbitrated question's verdict, and every verdict in its history,
 *    chooses one of its options and abandons exactly the others, each once,
 *    in any order.
 */
function firstQuestionViolation(
  openQuestions: ReadonlyArray<OpenQuestion>,
  arbitratedQuestions: ReadonlyArray<SpecArbitratedQuestion>,
): Violation | undefined {
  const located = [
    ...openQuestions.map((question, i) => ({
      question,
      path: ["openQuestions", i] as ReadonlyArray<PropertyKey>,
    })),
    ...arbitratedQuestions.map((question, i) => ({
      question,
      path: ["arbitratedQuestions", i] as ReadonlyArray<PropertyKey>,
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
    if (!question.options.some((o) => o.id === question.recommendation)) {
      return {
        path: [...path, "recommendation"],
        message: `"${question.recommendation}" names none of the question's options (${optionList(question)})`,
      };
    }
  }

  for (const [q, question] of arbitratedQuestions.entries()) {
    const path = ["arbitratedQuestions", q];
    const current = firstVerdictViolation(question, question.verdict, [...path, "verdict"]);
    if (current !== undefined) return current;
    for (const [h, earlier] of question.history.entries()) {
      const violation = firstVerdictViolation(question, earlier, [...path, "history", h]);
      if (violation !== undefined) return violation;
    }
  }

  return undefined;
}

const QUESTION_CHECKS_DESCRIPTION =
  "question ids are unique across openQuestions and arbitratedQuestions, and each question's option ids are unique; each question's `recommendation` names one of its options; and each arbitrated question's verdict, and every verdict in its history, has `chosen` name one of its options and `abandoned` hold exactly the others, each once";

const RequirementPatternSchema = Schema.Literal(
  "ubiquitous",
  "event",
  "state",
  "unwanted",
  "optional",
);

const GroundEntrySchema = Schema.Struct({
  path: Schema.NonEmptyString,
  note: Schema.NonEmptyString,
});

const TermSchema = Schema.Struct({
  term: Schema.NonEmptyString,
  definition: Schema.NonEmptyString,
});

const RequirementSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  pattern: RequirementPatternSchema,
  statement: Schema.NonEmptyString,
});

const SurfaceElementSchema = Schema.Struct({
  surface: Schema.String.pipe(Schema.pattern(/^(cli|config|file|api|package|internal): /)),
  binding: Schema.Literal("normative", "indicative"),
  before: Schema.NullOr(Schema.String),
  after: Schema.NonEmptyString,
});

const AcceptanceCriterionSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  given: Schema.NonEmptyString,
  when: Schema.NonEmptyString,
  // Given/when/then is the criterion's shape; the key is data, never awaited.
  // eslint-disable-next-line unicorn/no-thenable
  then: Schema.NonEmptyString,
  refs: Schema.NonEmptyArray(Schema.NonEmptyString),
});

const PlanningNoteSchema = Schema.Struct({
  settled: Schema.Array(Schema.NonEmptyString),
  open: Schema.Array(Schema.NonEmptyString),
  constraints: Schema.Array(Schema.NonEmptyString),
});

const DocsPageSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("page"),
    page: Schema.NonEmptyString,
    reader: Schema.NonEmptyString,
    example: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("none"),
    why: Schema.NonEmptyString,
  }),
);

const SpecDocumentStruct = Schema.Struct({
  $schema: SchemaUrlSchema,
  kind: Schema.Literal("spec"),
  title: Schema.NonEmptyString,
  ground: Schema.Array(GroundEntrySchema),
  context: Schema.NonEmptyString,
  problem: Schema.NonEmptyString,
  productGoal: Schema.Struct({
    statement: Schema.NonEmptyString,
    guidingRule: Schema.NonEmptyString,
  }),
  terminology: Schema.Array(TermSchema),
  requirements: Schema.NonEmptyArray(RequirementSchema),
  surface: Schema.Array(SurfaceElementSchema),
  nonGoals: Schema.Array(Schema.NonEmptyString),
  acceptanceCriteria: Schema.NonEmptyArray(AcceptanceCriterionSchema),
  openQuestions: Schema.Array(OpenQuestionSchema),
  arbitratedQuestions: Schema.Array(SpecArbitratedQuestionSchema),
  planningNote: PlanningNoteSchema,
  docsPage: DocsPageSchema,
});

type SpecDocumentStructType = Schema.Schema.Type<typeof SpecDocumentStruct>;

function firstDuplicateId(
  items: ReadonlyArray<{ readonly id: string }>,
  basePath: ReadonlyArray<PropertyKey>,
  label: string,
): Violation | undefined {
  const firstIndex = new Map<string, number>();
  for (const [i, item] of items.entries()) {
    const seen = firstIndex.get(item.id);
    if (seen !== undefined) {
      return {
        path: [...basePath, i, "id"],
        message: `"${item.id}" duplicates the ${label} id at index ${seen}`,
      };
    }
    firstIndex.set(item.id, i);
  }
  return undefined;
}

// Traceability, checked in a fixed order so the first violation reported for a
// given document is stable.
function firstTraceabilityViolation(doc: SpecDocumentStructType): Violation | undefined {
  const duplicateRequirement = firstDuplicateId(doc.requirements, ["requirements"], "requirement");
  if (duplicateRequirement !== undefined) return duplicateRequirement;

  const question = firstQuestionViolation(doc.openQuestions, doc.arbitratedQuestions);
  if (question !== undefined) return question;

  const requirementIds = new Set(doc.requirements.map((r) => r.id));
  for (const [c, criterion] of doc.acceptanceCriteria.entries()) {
    for (const [r, ref] of criterion.refs.entries()) {
      if (!requirementIds.has(ref)) {
        return {
          path: ["acceptanceCriteria", c, "refs", r],
          message: `"${ref}" names no requirement`,
        };
      }
    }
  }

  const referenced = new Set(doc.acceptanceCriteria.flatMap((c) => c.refs));
  for (const [i, requirement] of doc.requirements.entries()) {
    if (!referenced.has(requirement.id)) {
      return {
        path: ["requirements", i, "id"],
        message: `"${requirement.id}" is referenced by no acceptance criterion`,
      };
    }
  }

  return undefined;
}

// JSON Schema cannot express the traceability checks: the annotation declares
// the gap in the exported schema rather than dropping the filter silently. It
// adds no constraint, and decoding is unchanged.
const TRACEABILITY_DESCRIPTION = `Checked by phax's parser, not by this JSON Schema: requirement ids are unique; every acceptance criterion \`refs\` entry names an existing requirement; every requirement is referenced by at least one acceptance criterion; ${QUESTION_CHECKS_DESCRIPTION}.`;

export const SpecDocumentV0_25_0Schema = SpecDocumentStruct.pipe(
  Schema.filter(firstTraceabilityViolation, {
    jsonSchema: { description: TRACEABILITY_DESCRIPTION },
  }),
);

export type SpecDocumentV0_25_0 = Schema.Schema.Type<typeof SpecDocumentV0_25_0Schema>;

export const decodeSpecDocumentV0_25_0 = Schema.decodeUnknownEither(SpecDocumentV0_25_0Schema, {
  onExcessProperty: "error",
});
