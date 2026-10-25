import {
  type ParsedHandQuestions,
  parseHandAuthoredQuestions,
} from "../../../src/domain/artifact/questions.js";
import type { SidecarDocument } from "../../../src/domain/artifact/sidecar.js";
import type {
  BoundVerdict,
  BoundVerdicts,
  QuestionFacts,
  TranscribedVerdict,
} from "../../../src/domain/decide/verdicts.js";
import type { HandDecisionAnswer } from "../../../src/schemas/handDecisionAnswer.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import type { PlanDocument } from "../../../src/schemas/planDocument.js";
import type {
  OpenQuestion,
  PlanVerdict,
  SpecArbitratedQuestion,
  SpecVerdict,
} from "../../../src/schemas/questions.js";
import type { SpecDocument } from "../../../src/schemas/specDocument.js";

// Frozen fixtures for the oracles of verdicts mode's pure contract
// (src/domain/decide/verdicts.ts). Every spec, plan, question, operator and
// verdicts file is made up. Nothing here calls the contract: the oracles
// compose these values with it, and each transcription oracle takes its
// `bound` input from a literal below, so it does not depend on binding.

// ── Who and when ───────────────────────────────────────────────────────────

export const OPERATOR = { name: "Ada Lovelace" } as const;
export const AT_ISO = "2026-10-25T09:30:00.000Z";
export const PRINCIPLE_IDS: ReadonlySet<string> = new Set([
  "E0",
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
  "S7",
  "S8",
  "S9",
  "S10",
]);

// ── The headless spec ──────────────────────────────────────────────────────

export const SPEC_PATH = "docs/specs/2610250900-log-rotation.md";
export const OTHER_SPEC_PATH = "docs/specs/2610250901-log-format.md";

const Q_KEEP: OpenQuestion = {
  id: "q-keep",
  question: "How many logs does rotation keep?",
  options: [
    { id: "keep-10", label: "Ten logs", abandons: "a longer history" },
    { id: "keep-20", label: "Twenty logs", abandons: "disk space" },
  ],
  recommendation: "keep-10",
  rationale: "Ten logs cover a week of runs and keep the directory small.",
};

const Q_SCOPE: OpenQuestion = {
  id: "q-scope",
  question: "What does one rotation cover?",
  options: [
    { id: "per-run", label: "One run", abandons: "a daily summary" },
    { id: "per-day", label: "One day", abandons: "a log per run" },
  ],
  recommendation: "per-run",
  rationale: "A report names its run, so a log is kept with its run.",
};

const Q_NAMES: OpenQuestion = {
  id: "q-names",
  question: "How are rotated logs named?",
  options: [
    { id: "by-date", label: "By date", abandons: "a name that tells the run apart" },
    { id: "by-run", label: "By run", abandons: "a name that sorts by date" },
  ],
  recommendation: "by-date",
  rationale: "Dates sort in a listing and need no lookup.",
};

const PREVIOUS_KEEP_VERDICT: SpecVerdict = {
  kind: "decided",
  chosen: "keep-10",
  abandoned: ["keep-20"],
  why: "Ten logs cover a week.",
  advocate: "Twenty logs would keep a fortnight of runs.",
  principles: ["S1"],
  reversibility: "cheap",
  by: { kind: "operator", name: "Grace Hopper" },
  at: "2026-10-20T08:02:11.000Z",
  revised: [],
};

const SPEC_BASE: SpecDocument = {
  kind: "spec",
  title: "Log rotation",
  ground: [{ path: "src/app/logs.ts", note: "where logs are written" }],
  context: "Every run writes one log, and nothing ever removes it.",
  problem: "The log directory grows without bound.",
  productGoal: {
    statement: "Keep the log directory bounded.",
    guidingRule: "A log is kept while it can still be useful.",
  },
  terminology: [],
  requirements: [
    {
      id: "5.1",
      title: "Keep",
      pattern: "ubiquitous",
      statement: "THE system SHALL keep the ten most recent logs.",
    },
    {
      id: "5.2",
      title: "Rotate",
      pattern: "event",
      statement: "WHEN a run ends THE system SHALL rotate the logs.",
    },
    {
      id: "5.3",
      title: "Name",
      pattern: "ubiquitous",
      statement: "THE system SHALL name each rotated log by its date.",
    },
  ],
  surface: [],
  nonGoals: ["Compressing rotated logs."],
  acceptanceCriteria: [
    {
      id: "AC-1",
      name: "Ten logs stay",
      given: "eleven logs in the directory",
      when: "a run ends",
      // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
      then: "ten logs remain",
      refs: ["5.1"],
    },
    {
      id: "AC-2",
      name: "A run rotates",
      given: "a finished run",
      when: "its log is rotated",
      // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
      then: "the run's log is the newest",
      refs: ["5.2"],
    },
    {
      id: "AC-3",
      name: "A log is named by date",
      given: "a rotated log",
      when: "the directory is listed",
      // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
      then: "its name is the date of its run",
      refs: ["5.3"],
    },
  ],
  openQuestions: [Q_KEEP, Q_SCOPE, Q_NAMES],
  arbitratedQuestions: [],
  planningNote: { settled: [], open: [], constraints: [] },
  docsPage: { kind: "none", why: "the CLI reference covers it" },
};

/** The headless spec `log-rotation`: q-keep, q-scope and q-names open. */
export const SPEC: SidecarDocument = { kind: "spec", document: SPEC_BASE };

const KEEP_ARBITRATED: SpecArbitratedQuestion = {
  ...Q_KEEP,
  verdict: PREVIOUS_KEEP_VERDICT,
  history: [],
};

/** The same spec with q-keep already arbitrated, keep-10, by an operator verdict. */
export const SPEC_KEEP_DECIDED: SidecarDocument = {
  kind: "spec",
  document: {
    ...SPEC_BASE,
    openQuestions: [Q_SCOPE, Q_NAMES],
    arbitratedQuestions: [KEEP_ARBITRATED],
  },
};

// ── Facts, as the questions of those documents give them ───────────────────

const FACTS_KEEP_OPEN: QuestionFacts = {
  id: "q-keep",
  state: "open",
  optionIds: ["keep-10", "keep-20"],
  recommendation: "keep-10",
  rationale: Q_KEEP.rationale,
};

const FACTS_SCOPE: QuestionFacts = {
  id: "q-scope",
  state: "open",
  optionIds: ["per-run", "per-day"],
  recommendation: "per-run",
  rationale: Q_SCOPE.rationale,
};

const FACTS_NAMES: QuestionFacts = {
  id: "q-names",
  state: "open",
  optionIds: ["by-date", "by-run"],
  recommendation: "by-date",
  rationale: Q_NAMES.rationale,
};

const FACTS_KEEP_ARBITRATED: QuestionFacts = { ...FACTS_KEEP_OPEN, state: "arbitrated" };

/** What `questionFactsOfDocument(SPEC)` gives. */
export const SPEC_FACTS: readonly QuestionFacts[] = [FACTS_KEEP_OPEN, FACTS_SCOPE, FACTS_NAMES];

/** What `questionFactsOfDocument(SPEC_KEEP_DECIDED)` gives: open questions, then arbitrated. */
export const SPEC_KEEP_DECIDED_FACTS: readonly QuestionFacts[] = [
  FACTS_SCOPE,
  FACTS_NAMES,
  FACTS_KEEP_ARBITRATED,
];

// ── Bound verdicts, written out by hand ────────────────────────────────────

const KEEP_NOTE = "Ten logs cover a week of runs.";
const KEEP_20_NOTE = "Support asks for a fortnight of runs.";
const NAMES_OTHER_NOTE = "Name each log by its date and its phase.";

/** q-keep follows with a note, q-scope follows without one; q-names stays open. */
export const BOUND_FOLLOW: BoundVerdicts = {
  verdicts: [
    {
      question: "q-keep",
      state: "open",
      chosen: "keep-10",
      note: KEEP_NOTE,
      recommendation: "keep-10",
      departs: false,
      why: KEEP_NOTE,
    },
    {
      question: "q-scope",
      state: "open",
      chosen: "per-run",
      note: null,
      recommendation: "per-run",
      departs: false,
      why: Q_SCOPE.rationale,
    },
  ],
  open: ["q-names"],
};

/** Only q-keep, following with a note. */
export const BOUND_KEEP_FOLLOWS: BoundVerdicts = {
  verdicts: [BOUND_FOLLOW.verdicts[0] as BoundVerdict],
  open: ["q-scope", "q-names"],
};

/** Only q-keep, departing to keep-20 with a note. */
export const BOUND_KEEP_20: BoundVerdicts = {
  verdicts: [
    {
      question: "q-keep",
      state: "open",
      chosen: "keep-20",
      note: KEEP_20_NOTE,
      recommendation: "keep-10",
      departs: true,
      why: KEEP_20_NOTE,
    },
  ],
  open: ["q-scope", "q-names"],
};

/** Only q-names, choosing `other` with a note. */
export const BOUND_NAMES_OTHER: BoundVerdicts = {
  verdicts: [
    {
      question: "q-names",
      state: "open",
      chosen: "other",
      note: NAMES_OTHER_NOTE,
      recommendation: "by-date",
      departs: true,
      why: NAMES_OTHER_NOTE,
    },
  ],
  open: ["q-keep", "q-scope"],
};

/** The arbitrated q-keep, re-arbitrated to keep-20 with a note. */
export const BOUND_REARBITRATE_KEEP_20: BoundVerdicts = {
  verdicts: [
    {
      question: "q-keep",
      state: "arbitrated",
      chosen: "keep-20",
      note: KEEP_20_NOTE,
      recommendation: "keep-10",
      departs: true,
      why: KEEP_20_NOTE,
    },
  ],
  open: ["q-scope", "q-names"],
};

/** The arbitrated q-keep, re-arbitrated to keep-10 again, without a note. */
export const BOUND_REARBITRATE_SAME: BoundVerdicts = {
  verdicts: [
    {
      question: "q-keep",
      state: "arbitrated",
      chosen: "keep-10",
      note: null,
      recommendation: "keep-10",
      departs: false,
      why: Q_KEEP.rationale,
    },
  ],
  open: ["q-scope", "q-names"],
};

// ── Writer answers ─────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

// A writer's answer for a document: its sidecar form, `$schema` first. Not
// encoded, so an invalid document stays expressible.
function answerOf(sidecar: SidecarDocument): Json {
  const format = sidecar.kind === "spec" ? "spec-document" : "plan-document";
  return structuredClone({ $schema: currentSchemaUrl(format), ...sidecar.document }) as Json;
}

// The values a writer puts on a verdict phax then sets over: the oracles
// assert none of them survives.
const WRITER_BY = { kind: "operator", name: "Writer Session" } as const;
const WRITER_AT = "2020-01-01T00:00:00Z";
const WRITER_WHY = "The writer's own reason, which phax replaces.";

function writerVerdict(
  question: OpenQuestion,
  chosen: string,
  revised: readonly string[] = [],
  extra: Json = {},
): SpecVerdict {
  return {
    kind: "decided",
    chosen,
    abandoned: question.options.map((o) => o.id).filter((id) => id !== chosen),
    why: WRITER_WHY,
    advocate: "The abandoned option is simpler to explain.",
    principles: ["S1"],
    reversibility: "cheap",
    by: WRITER_BY,
    at: WRITER_AT,
    revised,
    ...extra,
  } as SpecVerdict;
}

function arbitratedWith(
  question: OpenQuestion,
  verdict: SpecVerdict,
  history: readonly SpecVerdict[] = [],
): SpecArbitratedQuestion {
  return { ...question, verdict, history };
}

function specAnswer(change: Json): Json {
  return { ...answerOf(SPEC), ...change };
}

function requirementStatement(id: string, statement: string): readonly unknown[] {
  return SPEC_BASE.requirements.map((r) => (r.id === id ? { ...r, statement } : r));
}

/** bound: BOUND_FOLLOW. q-keep and q-scope decided as recommended, q-names open. */
export const ANSWER_FOLLOW: Json = specAnswer({
  openQuestions: [Q_NAMES],
  arbitratedQuestions: [
    arbitratedWith(Q_KEEP, writerVerdict(Q_KEEP, "keep-10")),
    arbitratedWith(Q_SCOPE, writerVerdict(Q_SCOPE, "per-run")),
  ],
});

/** bound: BOUND_FOLLOW. The same decisions, with a why, by and at the writer chose. */
export const ANSWER_WRITER_STAMPS: Json = specAnswer({
  openQuestions: [Q_NAMES],
  arbitratedQuestions: [
    arbitratedWith(
      Q_KEEP,
      writerVerdict(Q_KEEP, "keep-10", [], {
        why: "Because the writer says so.",
        by: { kind: "operator", name: "Mallory" },
        at: "1999-12-31T23:59:59Z",
      }),
    ),
    arbitratedWith(
      Q_SCOPE,
      writerVerdict(Q_SCOPE, "per-run", [], {
        why: "Because the writer says so too.",
        by: { kind: "operator", name: "Mallory" },
        at: "1999-12-31T23:59:59Z",
      }),
    ),
  ],
});

/** bound: BOUND_KEEP_20. The writer chose keep-10 although keep-20 was given. */
export const ANSWER_WRONG_OPTION: Json = specAnswer({
  openQuestions: [Q_SCOPE, Q_NAMES],
  arbitratedQuestions: [arbitratedWith(Q_KEEP, writerVerdict(Q_KEEP, "keep-10", ["5.1"]))],
});

/** bound: BOUND_KEEP_FOLLOWS. The writer also moved q-names, which the file does not name. */
export const ANSWER_MOVES_NAMES: Json = specAnswer({
  openQuestions: [Q_SCOPE],
  arbitratedQuestions: [
    arbitratedWith(Q_KEEP, writerVerdict(Q_KEEP, "keep-10")),
    arbitratedWith(Q_NAMES, writerVerdict(Q_NAMES, "by-date")),
  ],
});

const RUN_PHASE_OPTION = {
  id: "run-phase",
  label: "By run and phase",
  abandons: "a short name",
};

/** bound: BOUND_NAMES_OTHER. The writer added an option run-phase to q-names and chose it. */
export const ANSWER_ADDS_OPTION: Json = specAnswer({
  openQuestions: [Q_KEEP, Q_SCOPE],
  requirements: requirementStatement("5.3", "THE system SHALL name each rotated log by its run."),
  arbitratedQuestions: [
    arbitratedWith(
      { ...Q_NAMES, options: [...Q_NAMES.options, RUN_PHASE_OPTION] },
      {
        ...writerVerdict(Q_NAMES, "run-phase", ["5.3"]),
        abandoned: ["by-date", "by-run"],
      },
    ),
  ],
});

/** bound: BOUND_KEEP_FOLLOWS. Every verdict follows, yet the writer edited requirement 5.1. */
export const ANSWER_EDITS_BODY: Json = specAnswer({
  openQuestions: [Q_SCOPE, Q_NAMES],
  requirements: requirementStatement(
    "5.1",
    "THE system SHALL keep the ten most recent logs and compress them.",
  ),
  arbitratedQuestions: [arbitratedWith(Q_KEEP, writerVerdict(Q_KEEP, "keep-10"))],
});

/** bound: BOUND_KEEP_FOLLOWS. The verdict cites S12, which the doctrine does not define. */
export const ANSWER_CITES_S12: Json = specAnswer({
  openQuestions: [Q_SCOPE, Q_NAMES],
  arbitratedQuestions: [
    arbitratedWith(Q_KEEP, writerVerdict(Q_KEEP, "keep-10", [], { principles: ["S12"] })),
  ],
});

/** bound: BOUND_KEEP_20. Departs to keep-20 and revises the body, but names no revised section. */
export const ANSWER_DEPARTS_WITHOUT_REVISED: Json = specAnswer({
  openQuestions: [Q_SCOPE, Q_NAMES],
  requirements: requirementStatement("5.1", "THE system SHALL keep the twenty most recent logs."),
  arbitratedQuestions: [arbitratedWith(Q_KEEP, writerVerdict(Q_KEEP, "keep-20", []))],
});

/** bound: BOUND_KEEP_FOLLOWS. The verdict follows its recommendation yet names a revised section. */
export const ANSWER_FOLLOW_WITH_REVISED: Json = specAnswer({
  openQuestions: [Q_SCOPE, Q_NAMES],
  arbitratedQuestions: [arbitratedWith(Q_KEEP, writerVerdict(Q_KEEP, "keep-10", ["5.1"]))],
});

/** bound: BOUND_KEEP_20. A departing verdict, with the requirement and criterion it implies revised. */
export const ANSWER_DEPARTS: Json = specAnswer({
  openQuestions: [Q_SCOPE, Q_NAMES],
  requirements: requirementStatement("5.1", "THE system SHALL keep the twenty most recent logs."),
  acceptanceCriteria: SPEC_BASE.acceptanceCriteria.map((c) =>
    c.id === "AC-1"
      ? {
          ...c,
          given: "twenty-one logs in the directory",
          // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
          then: "twenty logs remain",
        }
      : c,
  ),
  arbitratedQuestions: [arbitratedWith(Q_KEEP, writerVerdict(Q_KEEP, "keep-20", ["5.1", "AC-1"]))],
});

/** bound: BOUND_NAMES_OTHER. `other` chosen, every listed option abandoned, requirement 5.3 revised. */
export const ANSWER_OTHER: Json = specAnswer({
  openQuestions: [Q_KEEP, Q_SCOPE],
  requirements: requirementStatement(
    "5.3",
    "THE system SHALL name each rotated log by its date and its phase.",
  ),
  arbitratedQuestions: [arbitratedWith(Q_NAMES, writerVerdict(Q_NAMES, "other", ["5.3"]))],
});

function keptDecidedAnswer(change: Json): Json {
  return { ...answerOf(SPEC_KEEP_DECIDED), ...change };
}

/** bound: BOUND_REARBITRATE_KEEP_20, on SPEC_KEEP_DECIDED. The new verdict, the old one in history. */
export const ANSWER_REARBITRATE_KEEP_20: Json = keptDecidedAnswer({
  requirements: requirementStatement("5.1", "THE system SHALL keep the twenty most recent logs."),
  arbitratedQuestions: [
    arbitratedWith(Q_KEEP, writerVerdict(Q_KEEP, "keep-20", ["5.1"]), [PREVIOUS_KEEP_VERDICT]),
  ],
});

/** bound: BOUND_REARBITRATE_SAME, on SPEC_KEEP_DECIDED. keep-10 again: the old verdict still goes to history. */
export const ANSWER_REARBITRATE_SAME: Json = keptDecidedAnswer({
  arbitratedQuestions: [
    arbitratedWith(Q_KEEP, writerVerdict(Q_KEEP, "keep-10"), [PREVIOUS_KEEP_VERDICT]),
  ],
});

// ── What phax lands ────────────────────────────────────────────────────────

const OPERATOR_BY = { kind: "operator", name: OPERATOR.name } as const;

export const TRANSCRIBED_FOLLOW: readonly TranscribedVerdict[] = [
  {
    question: "q-keep",
    chosen: "keep-10",
    recommendation: "keep-10",
    departs: false,
    why: KEEP_NOTE,
    revised: [],
    by: OPERATOR_BY,
  },
  {
    question: "q-scope",
    chosen: "per-run",
    recommendation: "per-run",
    departs: false,
    why: Q_SCOPE.rationale,
    revised: [],
    by: OPERATOR_BY,
  },
];

export const PREVIOUS_KEEP: SpecVerdict = PREVIOUS_KEEP_VERDICT;

// ── The headless plan ──────────────────────────────────────────────────────

const PLAN_SOURCE_SPEC = SPEC_PATH;

const Q1: OpenQuestion = {
  id: "Q1",
  question: "Does the store rotate in one pass or two?",
  options: [
    { id: "one-pass", label: "One pass", abandons: "a cheap dry run" },
    { id: "two-pass", label: "Two passes", abandons: "a short run" },
  ],
  recommendation: "one-pass",
  rationale: "One pass keeps the store simple.",
};

const Q2: OpenQuestion = {
  id: "Q2",
  question: "Does the command live beside the store or apart?",
  options: [
    { id: "beside", label: "Beside", abandons: "a small command file" },
    { id: "apart", label: "Apart", abandons: "one file to read" },
  ],
  recommendation: "apart",
  rationale: "A command file stays thin when the store is elsewhere.",
};

function planPhase(id: string) {
  return {
    id,
    title: `Step ${id}`,
    planMarkdownAnchor: `#${id}-step`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode: "headless",
    oracle: null,
    commit: { subject: `feat: ${id}`, body: "Do the step." },
    objective: "Do the step.",
    detailedInstructions: [],
    boundaryContracts: null,
    testStrategy: [],
    implementationOrder: [],
    excludedScope: [],
    verification: "standard",
    expectedHandoff: "Nothing.",
    assignmentReason: null,
    model: "claude-sonnet-5",
    effort: "medium",
  };
}

const PLAN_BASE = {
  kind: "plan",
  sourceSpec: PLAN_SOURCE_SPEC,
  completesSpec: true,
  run: { shortName: "log-rotation", title: "Log rotation", requiredCommands: [] },
  preamble: {
    summary: "Two phases: the store, then the command.",
    requiredCommandsNote: "No extra commands.",
    technicalArbitrations: [],
    openQuestions: [Q1, Q2],
    arbitratedQuestions: [],
  },
  phases: [planPhase("phase-01"), planPhase("phase-02")],
} as PlanDocument;

/** The headless plan `log-rotation`: Q1 and Q2 open, phases phase-01 and phase-02. */
export const PLAN: SidecarDocument = { kind: "plan", document: PLAN_BASE };

export const PLAN_FACTS: readonly QuestionFacts[] = [
  {
    id: "Q1",
    state: "open",
    optionIds: ["one-pass", "two-pass"],
    recommendation: "one-pass",
    rationale: Q1.rationale,
  },
  {
    id: "Q2",
    state: "open",
    optionIds: ["beside", "apart"],
    recommendation: "apart",
    rationale: Q2.rationale,
  },
];

/** Q1 follows its recommendation without a note; Q2 stays open. */
export const BOUND_PLAN_Q1: BoundVerdicts = {
  verdicts: [
    {
      question: "Q1",
      state: "open",
      chosen: "one-pass",
      note: null,
      recommendation: "one-pass",
      departs: false,
      why: Q1.rationale,
    },
  ],
  open: ["Q2"],
};

function planAnswer(phase: string): Json {
  const verdict = {
    ...writerVerdict(Q1, "one-pass"),
    phase,
  } as PlanVerdict;
  return {
    ...(answerOf(PLAN) as Json),
    // A writer that rewrites the lineage: phax restores both from the original.
    sourceSpec: "docs/specs/2610250902-elsewhere.md",
    completesSpec: false,
    preamble: {
      ...PLAN_BASE.preamble,
      openQuestions: [Q2],
      arbitratedQuestions: [{ ...Q1, verdict, history: [] }],
    },
  };
}

/** bound: BOUND_PLAN_Q1. Q1's verdict bears on phase-02, a phase of the plan. */
export const ANSWER_PLAN_PHASE_02: Json = planAnswer("phase-02");

/** bound: BOUND_PLAN_Q1. Q1's verdict bears on phase-07, which the plan does not have. */
export const ANSWER_PLAN_PHASE_07: Json = planAnswer("phase-07");

// ── The hand-authored spec ─────────────────────────────────────────────────

export const HAND_SPEC_MD = [
  "---",
  "status: Draft",
  "date: 2026-10-25",
  "---",
  "# Log retention",
  "",
  "## 1. Context",
  "",
  "Every run writes one log.",
  "",
  "## 5. Requirements",
  "",
  "- 5.1 THE system SHALL keep the ten most recent logs.",
  "",
  "## 9. Open questions",
  "",
  "### Q1 — Retention: ten logs or twenty?",
  "",
  "- keep-10 — Ten logs — abandons: a longer history",
  "- keep-20 — Twenty logs — abandons: disk space",
  "",
  "Recommendation: keep-10 — ten logs cover a week of runs",
  "",
  "A longer history costs disk and nobody reads it.",
  "",
  "### Q2 — Names: by date or by run?",
  "",
  "- by-date — By date — abandons: a name that tells the run apart",
  "- by-run — By run — abandons: a name that sorts by date",
  "",
  "Recommendation: by-date — dates sort in a listing",
  "",
  "## 10. Implementation-planning note",
  "",
  "Settled: none.",
  "",
].join("\n");

function parsedHand(md: string): ParsedHandQuestions {
  const parsed = parseHandAuthoredQuestions("spec", md);
  if (parsed.kind !== "parsed") throw new Error("the hand-authored fixture does not parse");
  return parsed;
}

export const HAND_PARSED: ParsedHandQuestions = parsedHand(HAND_SPEC_MD);

/** Q1's whole rationale: the Recommendation line's text, a blank line, its continuation paragraph. */
export const HAND_Q1_RATIONALE =
  "ten logs cover a week of runs\n\nA longer history costs disk and nobody reads it.";

/** What `questionFactsOfHand(HAND_PARSED)` gives. */
export const HAND_FACTS: readonly QuestionFacts[] = [
  {
    id: "Q1",
    state: "open",
    optionIds: ["keep-10", "keep-20"],
    recommendation: "keep-10",
    rationale: HAND_Q1_RATIONALE,
  },
  {
    id: "Q2",
    state: "open",
    optionIds: ["by-date", "by-run"],
    recommendation: "by-date",
    rationale: "dates sort in a listing",
  },
];

/** A §9 section holding `None.` alone: parsed, with no question. */
const HAND_NO_QUESTIONS_MD = [
  "---",
  "status: Draft",
  "---",
  "# Log retention",
  "",
  "## 9. Open questions",
  "",
  "None.",
  "",
].join("\n");

export const HAND_NO_QUESTIONS_PARSED: ParsedHandQuestions = parsedHand(HAND_NO_QUESTIONS_MD);

/** Q1 follows its recommendation without a note; Q2 stays open. */
export const BOUND_HAND_Q1: BoundVerdicts = {
  verdicts: [
    {
      question: "Q1",
      state: "open",
      chosen: "keep-10",
      note: null,
      recommendation: "keep-10",
      departs: false,
      why: HAND_Q1_RATIONALE,
    },
  ],
  open: ["Q2"],
};

function handAnswer(
  chosen: string,
  abandoned: readonly string[],
  revised: readonly string[] = [],
): HandDecisionAnswer {
  return {
    kind: "spec",
    decisions: [
      {
        id: "Q1",
        verdict: {
          kind: "decided",
          chosen,
          abandoned,
          why: WRITER_WHY,
          advocate: "The abandoned option is simpler to explain.",
          principles: ["S1"],
          reversibility: "cheap",
          by: WRITER_BY,
          at: WRITER_AT,
          revised,
        },
      },
    ],
    markdown: HAND_SPEC_MD,
  };
}

/** The answer as the writer returns it, `$schema` first. */
function handAnswerJson(answer: HandDecisionAnswer): Json {
  return { $schema: currentSchemaUrl("hand-decision-answer"), ...answer };
}

/** bound: BOUND_HAND_Q1. Q1 decided keep-10; the Markdown as it was. */
export const HAND_ANSWER_Q1: Json = handAnswerJson(handAnswer("keep-10", ["keep-20"]));

/** bound: BOUND_HAND_Q1. The writer chose keep-20 although keep-10 was given, and names a revised section. */
export const HAND_ANSWER_WRONG_OPTION: Json = handAnswerJson(
  handAnswer("keep-20", ["keep-10"], ["5.1"]),
);

export const TRANSCRIBED_HAND_Q1: readonly TranscribedVerdict[] = [
  {
    question: "Q1",
    chosen: "keep-10",
    recommendation: "keep-10",
    departs: false,
    why: HAND_Q1_RATIONALE,
    revised: [],
    by: OPERATOR_BY,
  },
];

// ── Verdicts files, as text ────────────────────────────────────────────────

function fileText(change: Json): string {
  const file: Json = {
    $schema: currentSchemaUrl("decide-verdicts"),
    artifact: SPEC_PATH,
    verdicts: [
      { question: "q-keep", chosen: "keep-10", note: KEEP_NOTE },
      { question: "q-scope", chosen: "per-run", note: null },
    ],
    ...change,
  };
  for (const key of Object.keys(change)) {
    if (change[key] === undefined) delete file[key];
  }
  return JSON.stringify(file, null, 2);
}

/** A valid file: q-keep follows with a note, q-scope follows without one. */
export const FILE_VALID = fileText({});

/** Not JSON at all. */
export const FILE_NOT_JSON = "{ verdicts: [ q-keep keep-10 ";

export const FILE_NO_SCHEMA = fileText({ $schema: undefined });

/** The URL a file stamped with another format names. */
export const SPEC_DOCUMENT_URL = currentSchemaUrl("spec-document");

export const FILE_WRONG_FORMAT = fileText({ $schema: SPEC_DOCUMENT_URL });

/** The current decide-verdicts shape at another release than phax reads. */
export const OTHER_RELEASE_URL = currentSchemaUrl("decide-verdicts").replace(
  /\d+\.\d+\.\d+/,
  "0.1.0",
);

export const FILE_OTHER_RELEASE = fileText({ $schema: OTHER_RELEASE_URL });

export const FILE_EXTRA_KEY = fileText({ reason: "a note at the top" });

export const FILE_EMPTY_VERDICTS = fileText({ verdicts: [] });

export const FILE_NO_NOTE = fileText({ verdicts: [{ question: "q-keep", chosen: "keep-10" }] });

export const FILE_EMPTY_NOTE = fileText({
  verdicts: [{ question: "q-keep", chosen: "keep-10", note: "" }],
});

/** Names q-scope before q-keep: the bound order is the document's, not this one. */
export const FILE_REVERSED = fileText({
  verdicts: [
    { question: "q-scope", chosen: "per-run", note: null },
    { question: "q-keep", chosen: "keep-10", note: KEEP_NOTE },
  ],
});
