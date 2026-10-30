// The frozen 0.28.0 shape of `plan-document`: the sidecar phax 0.28.0 to
// 0.31.0 wrote, `$schema` first (a release pattern, not a const), the
// sourceSpec/completesSpec pairing in the schema, phases whose `testStrategy`
// is a list of test lines (their rules as lookahead patterns), questions in
// its preamble with the reserved `other` option id, and Effect's
// `NonEmptyString`. Never edit this module: packages/schemas/history.lock.json
// pins its bytes. In phax, only src/schemas/persisted.ts may import it. The
// schemas package lists it as the format's 0.28.0 release. It carries its own
// copy of the test line, question and lineage checks, so a later change to
// src/schemas/testLine.ts or questions.ts cannot move it.
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

const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/));

// ── test lines

// No line break and no control character: C0, DEL, C1 (U+0085 among them),
// U+2028 and U+2029.
// eslint-disable-next-line no-control-regex
const ONE_LINE = new RegExp("^[^\\x00-\\x1F\\x7F-\\x9F\\u2028\\u2029]*$");
// Neither starts nor ends with whitespace.
const TRIMMED = /^(?!\s)[\s\S]*\S$/;

const oneLineText = (coordinate: string) =>
  Schema.String.pipe(
    Schema.pattern(ONE_LINE, {
      message: () =>
        `a ${coordinate} is one line: no line break, U+2028, U+2029, U+0085 or other control character`,
    }),
    Schema.pattern(TRIMMED, {
      message: () => `a ${coordinate} is non-empty and trimmed: no leading or trailing whitespace`,
    }),
  );

const GuaranteeSchema = oneLineText("guarantee").annotations({
  description: "What the test guarantees: one non-empty, trimmed line.",
});

const OracleSchema = oneLineText("oracle").pipe(
  Schema.pattern(/^(?![\s\S]* — )/, {
    message: () => "an oracle never contains ' — ' (a space, an em dash, a space)",
  }),
  Schema.pattern(/^(?!— )/, {
    message: () =>
      "an oracle never starts with '— ' (an em dash and a space): it would read back as another line",
  }),
  Schema.pattern(/^(?![\s\S]* ·$)/, {
    message: () =>
      "an oracle never ends with ' ·' (a space and a middle dot): it would read back as another line",
  }),
  Schema.annotations({
    description:
      "What the test compares against: one non-empty, trimmed line, never holding ' — ', never starting with '— ' and never ending with ' ·'.",
  }),
);

const CriterionSchema = Schema.String.pipe(
  // eslint-disable-next-line no-control-regex
  Schema.pattern(/^[^\s`\x00-\x1F\x7F-\x9F]+$/, {
    message: () =>
      "a criterion is a run of non-whitespace characters holding no backtick and no control character",
  }),
  Schema.pattern(/^(?!(?:oracle|in-phase)$)/, {
    message: () => "a criterion is neither 'oracle' nor 'in-phase', the loop values",
  }),
  Schema.annotations({
    description:
      "An acceptance criterion id from the source spec's JSON sidecar: a run of non-whitespace characters, no backtick, neither 'oracle' nor 'in-phase'.",
  }),
);

const TestLineSchema = Schema.Struct({
  guarantee: GuaranteeSchema,
  size: Schema.Literal("small", "medium", "large"),
  technique: Schema.Literal(
    "example",
    "table",
    "property",
    "metamorphic",
    "stateful",
    "fuzz",
    "contract",
    "smoke",
  ),
  oracle: OracleSchema,
  loop: Schema.Literal("oracle", "in-phase"),
  criterion: Schema.NullOr(CriterionSchema),
}).annotations({
  description:
    "One test line of a phase's test strategy, rendered as `- <guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`, one per line under the phase's `### Test strategy` heading. `criterion` is an acceptance criterion id from the source spec's JSON sidecar, or null.",
});

// ── phase fields

const ExtractedPhaseFields = {
  id: PhaseIdSchema,
  model: Schema.NonEmptyString,
  effort: EffortSchema,
  planMarkdownAnchor: Schema.NonEmptyString,
  plannedFilesToCreate: Schema.Array(Schema.String),
  plannedFilesToEdit: Schema.Array(Schema.String),
  optionalFilesToEdit: Schema.Array(Schema.String),
  mode: Schema.Literal("headless", "interactive"),
  oracle: Schema.NullOr(
    Schema.Struct({
      dischargedBy: PhaseIdSchema,
      files: Schema.Array(Schema.NonEmptyString),
    }),
  ),
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

// ── questions

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

/** A plan question decided by the operator: the decided fields, plus the phase it bears on. */
const PlanDecidedVerdictSchema = Schema.Struct({
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

// The reserved option id every question implicitly offers.
const OTHER_OPTION_ID = "other";

function optionList(question: OpenQuestion): string {
  return question.options.map((o) => o.id).join(", ");
}

function choosableList(question: OpenQuestion): string {
  return `${optionList(question)}, ${OTHER_OPTION_ID}`;
}

function firstVerdictViolation(
  question: OpenQuestion,
  verdict: PlanVerdict,
  path: ReadonlyArray<PropertyKey>,
): Violation | undefined {
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

// The question checks of a plan's preamble, in their fixed order: unique
// question ids, unique option ids, the reserved `other`, the recommendation,
// every verdict, then a current decided verdict's phase.
function firstQuestionViolation(
  openQuestions: ReadonlyArray<OpenQuestion>,
  arbitratedQuestions: ReadonlyArray<PlanArbitratedQuestion>,
  phaseIds: ReadonlyArray<string>,
): Violation | undefined {
  const located = [
    ...openQuestions.map((question, i) => ({
      question,
      path: ["preamble", "openQuestions", i] as ReadonlyArray<PropertyKey>,
    })),
    ...arbitratedQuestions.map((question, i) => ({
      question,
      path: ["preamble", "arbitratedQuestions", i] as ReadonlyArray<PropertyKey>,
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

  for (const [q, question] of arbitratedQuestions.entries()) {
    const path = ["preamble", "arbitratedQuestions", q];
    const current = firstVerdictViolation(question, question.verdict, [...path, "verdict"]);
    if (current !== undefined) return current;
    for (const [h, earlier] of question.history.entries()) {
      const violation = firstVerdictViolation(question, earlier, [...path, "history", h]);
      if (violation !== undefined) return violation;
    }
  }

  for (const [q, { verdict }] of arbitratedQuestions.entries()) {
    if (verdict.kind === "decided" && !phaseIds.includes(verdict.phase)) {
      return {
        path: ["preamble", "arbitratedQuestions", q, "verdict", "phase"],
        message: `"${verdict.phase}" names none of the plan's phases (${phaseIds.join(", ")})`,
      };
    }
  }

  return undefined;
}

const QUESTION_CHECKS_DESCRIPTION =
  "question ids are unique across openQuestions and arbitratedQuestions, and each question's option ids are unique; no option has the id `other` and no `recommendation` is `other`, because `other` is reserved and implicit on every question; each question's `recommendation` names one of its options; and each arbitrated question's verdict, and every verdict in its history, has `chosen` name one of its options or the reserved `other`, and `abandoned` hold exactly the other listed options, each once (every listed option when `chosen` is `other`)";

// ── the document

const PlanDocumentPhaseSchema = Schema.Struct({
  id: ExtractedPhaseFields.id,
  title: Schema.NonEmptyString,
  objective: Schema.NonEmptyString,
  detailedInstructions: Schema.Array(Schema.NonEmptyString),
  planMarkdownAnchor: ExtractedPhaseFields.planMarkdownAnchor,
  plannedFilesToCreate: ExtractedPhaseFields.plannedFilesToCreate,
  plannedFilesToEdit: ExtractedPhaseFields.plannedFilesToEdit,
  optionalFilesToEdit: ExtractedPhaseFields.optionalFilesToEdit,
  mode: ExtractedPhaseFields.mode,
  oracle: ExtractedPhaseFields.oracle,
  boundaryContracts: Schema.NullOr(Schema.NonEmptyString),
  testStrategy: Schema.Array(TestLineSchema).annotations({
    description:
      "The phase's test lines. Each renders as one `- <guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]` line under `### Test strategy`; `[]` is a phase that tests nothing, rendered `- (none)`.",
  }),
  implementationOrder: Schema.Array(Schema.NonEmptyString),
  excludedScope: Schema.Array(Schema.NonEmptyString),
  verification: Schema.NonEmptyString,
  expectedHandoff: Schema.NonEmptyString,
  commit: ExtractedPhaseFields.commit,
  assignmentReason: Schema.NullOr(Schema.NonEmptyString).annotations({
    description:
      "Why this phase's model and effort depart from the assignment the phax-planning skill gives it; null when they do not. Rendered as an **Assignment reason:** line, never extracted.",
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

// The lineage check: a boolean `completesSpec` beside a `sourceSpec` path,
// null beside `sourceSpec: null`; then the question checks.
export const PlanDocumentV0_28_0Schema = PlanDocumentStruct.pipe(
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
  Schema.filter(
    (doc) =>
      firstQuestionViolation(
        doc.preamble.openQuestions,
        doc.preamble.arbitratedQuestions,
        doc.phases.map((phase) => phase.id),
      ),
    {
      jsonSchema: {
        description: `Checked by phax's parser, not by this JSON Schema, in the preamble: ${QUESTION_CHECKS_DESCRIPTION}; and a decided verdict's \`phase\` names one of the plan's phases.`,
      },
    },
  ),
);

export type PlanDocumentV0_28_0 = Schema.Schema.Type<typeof PlanDocumentV0_28_0Schema>;

export const decodePlanDocumentV0_28_0 = Schema.decodeUnknownEither(PlanDocumentV0_28_0Schema, {
  onExcessProperty: "error",
});
