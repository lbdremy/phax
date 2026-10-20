// The frozen 0.25.0 shape of `plan-document`: the sidecar phax 0.25.0 wrote,
// `$schema` first, phases ending `commit, modelReason, model, effort`, and
// questions in its preamble. Never edit this module: packages/schemas/history.lock.json
// pins its bytes. In phax, only src/schemas/persisted.ts may import it. The
// schemas package lists it as the format's 0.25.0 release. It carries its own
// copy of the question schemas and checks, so a later change to
// src/schemas/questions.ts cannot move it.
import { Schema } from "effect";

const SchemaUrlSchema = Schema.String.pipe(
  Schema.pattern(
    /^https:\/\/docs\.phax\.run\/schemas\/plan-document\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/,
  ),
  Schema.annotations({
    description:
      "The plan-document format's shape, named by the phax release that last changed it (not necessarily the release that wrote this file): https://docs.phax.run/schemas/plan-document/<X.Y.Z>.json",
  }),
);

const EffortSchema = Schema.Literal(
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

const ExtractedPhaseFields = {
  id: Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/)),
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  planMarkdownAnchor: Schema.NonEmptyString,
  plannedFilesToCreate: Schema.Array(Schema.String),
  plannedFilesToEdit: Schema.Array(Schema.String),
  optionalFilesToEdit: Schema.Array(Schema.String),
  commit: Schema.Struct({
    subject: Schema.NonEmptyString,
    body: Schema.NonEmptyString,
  }),
};

const ExtractedRunSchema = Schema.Struct({
  shortName: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  requiredCommands: Schema.Array(Schema.String),
});

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

/** A plan question decided by the operator: the decided fields, plus the phase it bears on. */
const PlanDecidedVerdictSchema = Schema.Struct({
  ...decidedVerdictFields,
  phase: Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/)),
});

const PlanVerdictSchema = Schema.Union(PlanDecidedVerdictSchema, LiftedVerdictSchema);

type PlanVerdict = Schema.Schema.Type<typeof PlanVerdictSchema>;

/** A plan question with its current verdict and its earlier ones, oldest first. */
const PlanArbitratedQuestionSchema = Schema.Struct({
  ...OpenQuestionSchema.fields,
  verdict: PlanVerdictSchema,
  history: Schema.Array(PlanVerdictSchema),
});

type PlanArbitratedQuestion = Schema.Schema.Type<typeof PlanArbitratedQuestionSchema>;

/** A document-relative path and what is wrong there. */
interface QuestionViolation {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

/** The two question arrays of a document, and where they sit in it. */
interface QuestionArrays {
  /** The path of the object holding both arrays: `[]` for a spec, `["preamble"]` for a plan. */
  readonly basePath: ReadonlyArray<PropertyKey>;
  readonly openQuestions: ReadonlyArray<OpenQuestion>;
  readonly arbitratedQuestions: ReadonlyArray<PlanArbitratedQuestion>;
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

function optionList(question: OpenQuestion): string {
  return question.options.map((o) => o.id).join(", ");
}

function firstVerdictViolation(
  question: OpenQuestion,
  verdict: PlanVerdict,
  path: ReadonlyArray<PropertyKey>,
): QuestionViolation | undefined {
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
 *    in any order;
 * 5. on a plan, a current decided verdict's `phase` names one of its phases.
 * Paths are document-relative, for `formatFirstViolation`.
 */
function firstQuestionViolation(arrays: QuestionArrays): QuestionViolation | undefined {
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

const QUESTION_CHECKS_DESCRIPTION =
  "question ids are unique across openQuestions and arbitratedQuestions, and each question's option ids are unique; each question's `recommendation` names one of its options; and each arbitrated question's verdict, and every verdict in its history, has `chosen` name one of its options and `abandoned` hold exactly the others, each once";

const PlanDocumentPhaseSchema = Schema.Struct({
  id: ExtractedPhaseFields.id,
  title: Schema.NonEmptyString,
  objective: Schema.NonEmptyString,
  detailedInstructions: Schema.Array(Schema.NonEmptyString),
  planMarkdownAnchor: ExtractedPhaseFields.planMarkdownAnchor,
  plannedFilesToCreate: ExtractedPhaseFields.plannedFilesToCreate,
  plannedFilesToEdit: ExtractedPhaseFields.plannedFilesToEdit,
  optionalFilesToEdit: ExtractedPhaseFields.optionalFilesToEdit,
  boundaryContracts: Schema.NullOr(Schema.NonEmptyString),
  testStrategy: Schema.NonEmptyString,
  implementationOrder: Schema.Array(Schema.NonEmptyString),
  excludedScope: Schema.Array(Schema.NonEmptyString),
  verification: Schema.NonEmptyString,
  expectedHandoff: Schema.NonEmptyString,
  commit: ExtractedPhaseFields.commit,
  modelReason: Schema.NullOr(Schema.NonEmptyString).annotations({
    description:
      "Why this phase departs from the phax-planning skill's default phase assignment; null when it takes the default. Rendered as a **Model reason:** line, never extracted.",
  }),
  model: ExtractedPhaseFields.model,
  effort: ExtractedPhaseFields.effort,
});

const PlanDocumentStruct = Schema.Struct({
  $schema: SchemaUrlSchema,
  kind: Schema.Literal("plan"),
  sourceSpec: Schema.NullOr(Schema.NonEmptyString),
  completesSpec: Schema.NullOr(Schema.Boolean).annotations({
    description:
      "Whether this plan's run completes its source spec: true when it is the spec's last plan, false when more plans of the spec follow. A boolean beside a sourceSpec path; null beside sourceSpec: null.",
  }),
  run: ExtractedRunSchema,
  preamble: Schema.Struct({
    summary: Schema.NonEmptyString,
    requiredCommandsNote: Schema.NonEmptyString,
    technicalArbitrations: Schema.Array(Schema.NonEmptyString),
    openQuestions: Schema.Array(OpenQuestionSchema),
    arbitratedQuestions: Schema.Array(PlanArbitratedQuestionSchema),
  }),
  phases: Schema.NonEmptyArray(PlanDocumentPhaseSchema),
});

type PlanDocumentStructType = Schema.Schema.Type<typeof PlanDocumentStruct>;

/** A plan's lineage, one legal form per variant. */
type PlanDocumentLineage =
  | { readonly sourceSpec: string; readonly completesSpec: boolean }
  | { readonly sourceSpec: null; readonly completesSpec: null };

// The question checks, plus a decided verdict's phase. JSON Schema cannot
// express them: the annotation declares the gap.
interface QuestionBearing {
  readonly preamble: {
    readonly openQuestions: ReadonlyArray<OpenQuestion>;
    readonly arbitratedQuestions: ReadonlyArray<PlanArbitratedQuestion>;
  };
  readonly phases: ReadonlyArray<{ readonly id: string }>;
}

function firstPlanQuestionViolation(doc: QuestionBearing) {
  return firstQuestionViolation({
    basePath: ["preamble"],
    openQuestions: doc.preamble.openQuestions,
    arbitratedQuestions: doc.preamble.arbitratedQuestions,
    phaseIds: doc.phases.map((phase) => phase.id),
  });
}

const QUESTIONS_FILTER_OPTIONS = {
  jsonSchema: {
    description: `Checked by phax's parser, not by this JSON Schema, in the preamble: ${QUESTION_CHECKS_DESCRIPTION}; and a decided verdict's \`phase\` names one of the plan's phases.`,
  },
};

// The lineage check: a boolean `completesSpec` beside a `sourceSpec` path,
// null beside `sourceSpec: null`.
export const PlanDocumentV0_25_0Schema = PlanDocumentStruct.pipe(
  Schema.filter(
    (doc: PlanDocumentStructType): doc is PlanDocumentStructType & PlanDocumentLineage =>
      (doc.sourceSpec === null) === (doc.completesSpec === null),
    {
      message: () =>
        "completesSpec is a boolean beside a sourceSpec path and null beside sourceSpec: null",
      jsonSchema: {
        allOf: [
          {
            oneOf: [
              {
                properties: {
                  sourceSpec: { type: "string", minLength: 1 },
                  completesSpec: { type: "boolean" },
                },
              },
              { properties: { sourceSpec: { type: "null" }, completesSpec: { type: "null" } } },
            ],
          },
        ],
      },
    },
  ),
  Schema.filter(firstPlanQuestionViolation, QUESTIONS_FILTER_OPTIONS),
);

export type PlanDocumentV0_25_0 = Schema.Schema.Type<typeof PlanDocumentV0_25_0Schema>;

export const decodePlanDocumentV0_25_0 = Schema.decodeUnknownEither(PlanDocumentV0_25_0Schema, {
  onExcessProperty: "error",
});
