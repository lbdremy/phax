import type { SidecarDocument } from "../../../src/domain/artifact/sidecar.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import type { PlanDocument } from "../../../src/schemas/planDocument.js";
import type { OpenQuestion, PlanArbitratedQuestion } from "../../../src/schemas/questions.js";
import type { SpecDocument } from "../../../src/schemas/specDocument.js";
import { SPEC_KEEP_DECIDED } from "../decide/verdictsFixtures.js";

// Frozen fixtures for the acceptance tests of `phax artifact revise`: a headless
// spec and a headless plan, each with open and arbitrated questions, and every
// answer a writer gives in them. Every name, path and operator is made up. An
// answer is a plain object, so an invalid document stays expressible; the tests
// stringify it as the writer's final message.

type Json = Record<string, unknown>;

// ── The amendment ──────────────────────────────────────────────────────────

/** What the operator asks for; the commit body carries it verbatim. */
export const AMENDMENT =
  "Say in the summary that rotation also runs when the process is stopped.\n\nKeep the rest as it is.\n";

/** The kept brief the authoring session was started from. */
export const KEPT_BRIEF = "Keep the log directory bounded: rotate the logs of finished runs.\n";

// ── The headless spec ──────────────────────────────────────────────────────

export const REVISE_SPEC_PATH = "docs/specs/2610250900-log-rotation.md";
export const REVISE_SPEC_SIDECAR = "docs/specs/2610250900-log-rotation.json";
/** The authoring id of the spec: `<stamp>-<slug>`. */
export const REVISE_SPEC_ID = "2610250900-log-rotation";
export const SPEC_FRONTMATTER =
  "---\nstatus: Draft\ndate: 2026-10-25\naudience: maintainers\nscope: logs\n---\n";

const SPEC_BASE = SPEC_KEEP_DECIDED.document as SpecDocument;

/** The spec `log-rotation`: q-scope open, q-keep arbitrated (keep-10). */
export const REVISE_SPEC: SidecarDocument = {
  kind: "spec",
  document: {
    ...SPEC_BASE,
    openQuestions: SPEC_BASE.openQuestions.filter((q) => q.id === "q-scope"),
  },
};

const SPEC_DOC = REVISE_SPEC.document as SpecDocument;

// ── The headless plan ──────────────────────────────────────────────────────

export const REVISE_PLAN_ID = "2610250930-log-rotation";
export const REVISE_PLAN_PATH = `docs/plans/${REVISE_PLAN_ID}-plan.md`;
export const REVISE_PLAN_SIDECAR = `docs/plans/${REVISE_PLAN_ID}-plan.json`;
export const SOURCE_SPEC = "docs/specs/2610250800-log-rotation.md";
const OTHER_SOURCE_SPEC = "docs/specs/2610250801-log-format.md";
export const PLAN_FRONTMATTER = `---\nstatus: Draft\nsource-spec: ${SOURCE_SPEC}\ncompletes-spec: false\n---\n`;

const PLAN_Q1: OpenQuestion = {
  id: "Q1",
  question: "Does the store rotate in one pass or two?",
  options: [
    { id: "one-pass", label: "One pass", abandons: "a cheap dry run" },
    { id: "two-pass", label: "Two passes", abandons: "a short run" },
  ],
  recommendation: "one-pass",
  rationale: "One pass keeps the store simple.",
};

const PLAN_Q2: OpenQuestion = {
  id: "Q2",
  question: "Does the command live beside the store or apart?",
  options: [
    { id: "beside", label: "Beside", abandons: "a small command file" },
    { id: "apart", label: "Apart", abandons: "one file to read" },
  ],
  recommendation: "apart",
  rationale: "A command file stays thin when the store is elsewhere.",
};

const PLAN_Q3_OPEN: OpenQuestion = {
  id: "Q3",
  question: "Are rotated logs named by date or by run?",
  options: [
    { id: "by-date", label: "By date", abandons: "a name that tells runs apart" },
    { id: "by-run", label: "By run", abandons: "a name that sorts by date" },
  ],
  recommendation: "by-date",
  rationale: "Dates sort in a listing and need no lookup.",
};

/** The plan's arbitrated question: Q3, decided by-date by an operator. */
const PLAN_Q3: PlanArbitratedQuestion = {
  ...PLAN_Q3_OPEN,
  verdict: {
    kind: "decided",
    chosen: "by-date",
    abandoned: ["by-run"],
    why: "A listing sorts by date.",
    advocate: "A run id tells runs apart in one glance.",
    principles: ["P1"],
    reversibility: "cheap",
    by: { kind: "operator", name: "Grace Hopper" },
    at: "2026-10-20T08:02:11.000Z",
    revised: [],
    phase: "phase-02",
  },
  history: [],
};

/** The new open question a writer appends: not an id the artifact has. */
export const NEW_QUESTION: OpenQuestion = {
  id: "Q9",
  question: "Does a stopped process rotate its own log?",
  options: [
    { id: "rotate-on-stop", label: "Rotate on stop", abandons: "a quick shutdown" },
    { id: "rotate-on-next-run", label: "Rotate on next run", abandons: "a tidy directory" },
  ],
  recommendation: "rotate-on-next-run",
  rationale: "A stopping process should stop quickly.",
};

function planPhase(id: string): PlanDocument["phases"][number] {
  return {
    id,
    title: `Step ${id}`,
    planMarkdownAnchor: `#${id}-step`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [`src/${id}.ts`],
    optionalFilesToEdit: [],
    mode: "headless",
    acceptance: null,
    commit: { subject: `feat: ${id}`, body: "Do the step." },
    objective: "Do the step.",
    detailedInstructions: ["Do it."],
    boundaryContracts: null,
    testStrategy: [
      {
        guarantee: "The step does its work",
        size: "small",
        technique: "example",
        oracle: "the step's output",
        loop: "in-phase",
        criterion: null,
      },
    ],
    implementationOrder: ["Do it."],
    excludedScope: [],
    verification: "The `standard` gate profile.",
    expectedHandoff: "Nothing.",
    assignmentReason: null,
    model: "claude-sonnet-5-5",
    effort: "medium",
  };
}

function planDocument(
  open: readonly OpenQuestion[],
  decided: readonly PlanArbitratedQuestion[] = [PLAN_Q3],
  summary = "Two phases: the rotation, then its docs.",
): PlanDocument {
  return {
    kind: "plan",
    sourceSpec: SOURCE_SPEC,
    completesSpec: false,
    run: { shortName: "log-rotation", title: "Log rotation", requiredCommands: [] },
    preamble: {
      summary,
      requiredCommandsNote: "No extra commands.",
      technicalArbitrations: [],
      openQuestions: [...open],
      arbitratedQuestions: [...decided],
    },
    phases: [planPhase("phase-01"), planPhase("phase-02")],
  };
}

/** The plan `log-rotation`: Q1 and Q2 open, Q3 arbitrated. */
export const REVISE_PLAN: SidecarDocument = {
  kind: "plan",
  document: planDocument([PLAN_Q1, PLAN_Q2]),
};

// ── Writer answers ─────────────────────────────────────────────────────────

/** A document as a writer answers it: its sidecar form, `$schema` first, unencoded. */
function answerOf(sidecar: SidecarDocument): Json {
  const format = sidecar.kind === "spec" ? "spec-document" : "plan-document";
  return structuredClone({ $schema: currentSchemaUrl(format), ...sidecar.document }) as Json;
}

function planAnswer(document: PlanDocument): Json {
  return answerOf({ kind: "plan", document });
}

function specAnswer(change: Partial<SpecDocument>): Json {
  return answerOf({ kind: "spec", document: { ...SPEC_DOC, ...change } });
}

export const REVISED_PLAN_SUMMARY =
  "Two phases: the rotation, then its docs. Rotation also runs when the process is stopped.";
const REVISED_SPEC_CONTEXT =
  "Every run writes one log, and nothing ever removes it. Rotation also runs when the process is stopped.";

/** A valid revised plan: its summary, a body field, carries the amendment. */
export const PLAN_ANSWER_REVISED: Json = planAnswer(
  planDocument([PLAN_Q1, PLAN_Q2], [PLAN_Q3], REVISED_PLAN_SUMMARY),
);

/** A valid revised spec: its context carries the amendment. */
export const SPEC_ANSWER_REVISED: Json = specAnswer({ context: REVISED_SPEC_CONTEXT });

/** The revised plan, also appending the open question Q9. */
export const PLAN_ANSWER_APPENDS_Q9: Json = planAnswer(
  planDocument([PLAN_Q1, PLAN_Q2, NEW_QUESTION], [PLAN_Q3], REVISED_PLAN_SUMMARY),
);

/** The revised spec, also appending the open question Q9. */
export const SPEC_ANSWER_APPENDS_Q9: Json = specAnswer({
  context: REVISED_SPEC_CONTEXT,
  openQuestions: [...SPEC_DOC.openQuestions, NEW_QUESTION],
});

/** The revised plan, but with the arbitrated Q3's verdict `why` edited. */
export const PLAN_ANSWER_EDITS_VERDICT: Json = planAnswer(
  planDocument(
    [PLAN_Q1, PLAN_Q2],
    [{ ...PLAN_Q3, verdict: { ...PLAN_Q3.verdict, why: "The writer rewrote the reason." } }],
    REVISED_PLAN_SUMMARY,
  ),
);

/** The revised plan, but with the open question Q2 removed. */
export const PLAN_ANSWER_REMOVES_OPEN: Json = planAnswer(
  planDocument([PLAN_Q1], [PLAN_Q3], REVISED_PLAN_SUMMARY),
);

/** The revised plan, but with Q1 and Q2 swapped. */
export const PLAN_ANSWER_REORDERS: Json = planAnswer(
  planDocument([PLAN_Q2, PLAN_Q1], [PLAN_Q3], REVISED_PLAN_SUMMARY),
);

/** Prose, where the document should be. */
export const ANSWER_PROSE = "I carried the amendment into the summary, as you asked.";

/** The revised plan without its `$schema`. */
export const PLAN_ANSWER_NO_SCHEMA: Json = (() => {
  const { $schema: _stamp, ...rest } = PLAN_ANSWER_REVISED;
  return rest;
})();

/** The revised plan whose `sourceSpec` names another spec. */
export const PLAN_ANSWER_OTHER_SOURCE_SPEC: Json = {
  ...PLAN_ANSWER_REVISED,
  sourceSpec: OTHER_SOURCE_SPEC,
};

/** The current plan, unchanged. */
export const PLAN_ANSWER_UNCHANGED: Json = answerOf(REVISE_PLAN);

/** The current spec, unchanged. */
export const SPEC_ANSWER_UNCHANGED: Json = answerOf(REVISE_SPEC);
