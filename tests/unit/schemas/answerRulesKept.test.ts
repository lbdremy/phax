// The strict answers keep every rule of the shapes they replace. For each
// answer, a table of fixtures is decoded by the frozen module of today's shape
// (first-reading and interactive-handoff 0.26.0, code-review 0.29.0,
// spec-document 0.27.0, plan-document 0.28.0, hand-decision-answer 0.25.0) and
// by the new decoder: a fixture the frozen module refuses, the new decoder
// refuses naming the same field (and, for the documents, with the same
// message); a fixture it accepts, the new decoder accepts once restamped with
// the `$schema` const. The old hand-decision union splits in two: its spec
// member is a spec-hand-decision-answer, its plan member a
// plan-hand-decision-answer. The extraction format has no frozen
// module: its fixtures record the verdicts of the answer it replaces. The
// stricter parts — the `$schema` const, the unknown `version` — are covered in
// their own tests.
import { Either, ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { decodeCodeReviewFile } from "../../../src/schemas/codeReview.js";
import { decodeFirstReadingFile } from "../../../src/schemas/firstReading.js";
import { formatFirstViolation } from "../../../src/schemas/formatError.js";
import {
  decodePlanHandDecisionAnswerFile,
  decodeSpecHandDecisionAnswerFile,
} from "../../../src/schemas/handDecisionAnswer.js";
import { decodeCodeReviewV0_29_0 } from "../../../src/schemas/history/code-review/0.29.0.js";
import { decodeFirstReadingV0_26_0 } from "../../../src/schemas/history/first-reading/0.26.0.js";
import { decodeHandDecisionAnswerV0_25_0 } from "../../../src/schemas/history/hand-decision-answer/0.25.0.js";
import { decodeInteractiveHandoffV0_26_0 } from "../../../src/schemas/history/interactive-handoff/0.26.0.js";
import { decodePlanDocumentV0_28_0 } from "../../../src/schemas/history/plan-document/0.28.0.js";
import { decodeSpecDocumentV0_27_0 } from "../../../src/schemas/history/spec-document/0.27.0.js";
import { decodeInteractiveHandoffFile } from "../../../src/schemas/interactiveHandoff.js";
import {
  decodeAuthoredPlanDocument,
  decodePlanDocumentFile,
} from "../../../src/schemas/planDocument.js";
import { readPlanExtractionAnswer } from "../../../src/schemas/planExtraction.js";
import { AUTHORING_ARBITRATED_MESSAGE } from "../../../src/schemas/questions.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl, type FormatId } from "../../../src/schemas/schemaUrl.js";
import {
  decodeAuthoredSpecDocument,
  decodeSpecDocumentFile,
} from "../../../src/schemas/specDocument.js";
import { validDocuments } from "../schemasPackage/documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;
type Body = Readonly<Record<string, unknown>>;

/** The path of a decode's first violation, `findings[0].lens` style. */
function firstPath(error: ParseResult.ParseError): string {
  const [first] = ParseResult.ArrayFormatter.formatErrorSync(error);
  return (first?.path ?? [])
    .map((segment, i) =>
      typeof segment === "number" ? `[${segment}]` : `${i === 0 ? "" : "."}${String(segment)}`,
    )
    .join("");
}

interface Answer {
  readonly id: FormatId;
  readonly frozen: Decode;
  readonly frozenStamp: string;
  readonly current: Decode;
  readonly fixtures: ReadonlyArray<readonly [string, Body]>;
  /** Whether a refusal must also carry the frozen module's message. */
  readonly sameMessage?: boolean;
}

const without = (body: Body, key: string): Body => {
  const { [key]: _omitted, ...rest } = body;
  return rest;
};

const reading: Body = {
  pattern: ["Each export row is built by one pure function."],
  copiedBy: [{ phase: "phase-02", what: "the credit-note rows copy the row builder" }],
  toCheck: ["Whether the credit-note rows should round per line."],
};

const handoff: Body = {
  corrections: [
    { what: "Rounded per line.", guard: { kind: "test", ref: "tests/unit/exportRows.test.ts" } },
    { what: "Renamed the builder.", guard: { kind: "none", reason: "The typechecker guards it." } },
  ],
  patternFromNowOn: ["Round each line, then sum."],
  nextPhasesNeedToKnow: ["The credit-note rows follow the per-line rounding."],
};

const finding = {
  severity: "bug",
  file: "src/cli/greet.ts",
  line: 42,
  message: "An empty --name prints Hello, !",
  lens: "surface",
  escape: "unexplored-input",
  criterion: null,
  suggestion: "Refuse an empty --name with exit 2.",
};

const review = (...overrides: ReadonlyArray<Record<string, unknown>>): Body => ({
  findings: overrides.map((o) => ({ ...finding, ...o })),
});

/** A current document's body: everything but its `$schema`. */
const bodyOf = (id: FormatId): Body => without(validDocuments[id], "$schema");

const spec = bodyOf("spec-document");
const planBody = bodyOf("plan-document");
const SPEC_PATH = "docs/specs/2610300900-invoice-export.md";

const openQuestion = {
  id: "q-scope",
  question: "Export per invoice or per day?",
  options: [
    { id: "invoice", label: "per invoice", abandons: "one file a day" },
    { id: "day", label: "per day", abandons: "one file an invoice" },
  ],
  recommendation: "invoice",
  rationale: "an invoice is the unit of audit",
};
const oneOption = { ...openQuestion, options: [openQuestion.options[0]] };

const withPreamble = (preamble: Body): Body => ({
  ...planBody,
  preamble: { ...(planBody["preamble"] as Body), ...preamble },
});
const planPhases = planBody["phases"] as ReadonlyArray<Body>;
/** The plan with its first phase's first test line's coordinate set to `value`. */
const withTestLine = (coordinate: string, value: unknown): Body => {
  const [first, ...rest] = planPhases;
  const [line, ...lines] = first!["testStrategy"] as ReadonlyArray<Body>;
  return {
    ...planBody,
    phases: [{ ...first, testStrategy: [{ ...line, [coordinate]: value }, ...lines] }, ...rest],
  };
};

const handVerdict = {
  kind: "decided",
  chosen: "day",
  abandoned: ["invoice"],
  why: "one file a day is what accounting reads",
  advocate: "an invoice is the unit of audit",
  principles: ["S1"],
  reversibility: "cheap",
  by: { kind: "operator", name: "Example Operator" },
  at: "2026-10-30T09:00:00Z",
  revised: [],
};
const specHand: Body = {
  kind: "spec",
  decisions: [{ id: "q-scope", verdict: handVerdict }],
  markdown: "---\nstatus: Draft\n---\n# Invoice export\n",
};
const planHand: Body = {
  kind: "plan",
  decisions: [{ id: "q-scope", verdict: { ...handVerdict, phase: "phase-01" } }],
  markdown: "---\nstatus: Draft\n---\n# Invoice export\n",
};

const ANSWERS: ReadonlyArray<Answer> = [
  {
    id: "spec-document",
    frozen: decodeSpecDocumentV0_27_0,
    frozenStamp: schemaUrl("spec-document", "0.27.0"),
    current: decodeSpecDocumentFile,
    sameMessage: true,
    fixtures: [
      ["a full spec", spec],
      ["an open question", { ...spec, openQuestions: [openQuestion] }],
      ["a question with one option", { ...spec, openQuestions: [oneOption] }],
      [
        "a recommendation naming no option",
        { ...spec, openQuestions: [{ ...openQuestion, recommendation: "week" }] },
      ],
      ["an empty title", { ...spec, title: "" }],
      ["no requirement", { ...spec, requirements: [] }],
      ["no arbitratedQuestions key", without(spec, "arbitratedQuestions")],
      ["an extra root key", { ...spec, summary: "x" }],
    ],
  },
  {
    id: "plan-document",
    frozen: decodePlanDocumentV0_28_0,
    frozenStamp: schemaUrl("plan-document", "0.28.0"),
    current: decodePlanDocumentFile,
    sameMessage: true,
    fixtures: [
      ["a spec-less plan", planBody],
      ["a plan of a spec", { ...planBody, sourceSpec: SPEC_PATH, completesSpec: false }],
      ["a boolean beside no spec", { ...planBody, completesSpec: true }],
      ["null beside a spec path", { ...planBody, sourceSpec: SPEC_PATH }],
      ["an empty sourceSpec", { ...planBody, sourceSpec: "", completesSpec: true }],
      ["an open question", withPreamble({ openQuestions: [openQuestion] })],
      ["a question with one option", withPreamble({ openQuestions: [oneOption] })],
      ["an empty summary", withPreamble({ summary: "" })],
      ["a multi-line guarantee", withTestLine("guarantee", "one\ntwo")],
      ["a guarantee with a trailing space", withTestLine("guarantee", "done ")],
      ["an oracle holding ' — '", withTestLine("oracle", "a — b")],
      ["an oracle opening '— '", withTestLine("oracle", "— the output")],
      ["an oracle closing ' ·'", withTestLine("oracle", "the output ·")],
      ["a criterion 'oracle'", withTestLine("criterion", "oracle")],
      ["a criterion 'in-phase'", withTestLine("criterion", "in-phase")],
      ["a criterion holding a space", withTestLine("criterion", "ac one")],
      ["a phase with no oracle key", { ...planBody, phases: [without(planPhases[0]!, "oracle")] }],
      ["an extra root key", { ...planBody, version: 1 }],
    ],
  },
  {
    id: "spec-hand-decision-answer",
    frozen: decodeHandDecisionAnswerV0_25_0,
    frozenStamp: schemaUrl("hand-decision-answer", "0.25.0"),
    current: decodeSpecHandDecisionAnswerFile,
    fixtures: [
      ["a spec answer", specHand],
      ["nothing decided", { ...specHand, decisions: [] }],
      ["an empty markdown", { ...specHand, markdown: "" }],
      [
        "a question id holding a space",
        { ...specHand, decisions: [{ id: "q scope", verdict: handVerdict }] },
      ],
      ["an extra root key", { ...specHand, note: "x" }],
    ],
  },
  {
    id: "plan-hand-decision-answer",
    frozen: decodeHandDecisionAnswerV0_25_0,
    frozenStamp: schemaUrl("hand-decision-answer", "0.25.0"),
    current: decodePlanHandDecisionAnswerFile,
    fixtures: [
      ["a plan answer", planHand],
      ["nothing decided", { ...planHand, decisions: [] }],
      ["an empty markdown", { ...planHand, markdown: "" }],
      [
        "an empty phase",
        { ...planHand, decisions: [{ id: "q-scope", verdict: { ...handVerdict, phase: "" } }] },
      ],
      ["an extra root key", { ...planHand, note: "x" }],
    ],
  },
  {
    id: "first-reading",
    frozen: decodeFirstReadingV0_26_0,
    frozenStamp: schemaUrl("first-reading", "0.26.0"),
    current: decodeFirstReadingFile,
    fixtures: [
      ["a full reading", reading],
      ["nothing copied, nothing to check", { ...reading, copiedBy: [], toCheck: [] }],
      ["a whitespace-only statement", { ...reading, pattern: [" "] }],
      ["a multi-line statement", { ...reading, pattern: ["line one\nline two"] }],
      ["an empty pattern list", { ...reading, pattern: [] }],
      ["an empty pattern statement", { ...reading, pattern: [""] }],
      ["no pattern key", without(reading, "pattern")],
      [
        "a copying phase id off the format",
        { ...reading, copiedBy: [{ phase: "phase-1", what: "x" }] },
      ],
      ["an empty what", { ...reading, copiedBy: [{ phase: "phase-02", what: "" }] }],
      [
        "an extra key in copiedBy",
        { ...reading, copiedBy: [{ phase: "phase-02", what: "x", why: "y" }] },
      ],
      ["an empty toCheck item", { ...reading, toCheck: [""] }],
      ["no toCheck key", without(reading, "toCheck")],
      ["an extra root key", { ...reading, summary: "x" }],
    ],
  },
  {
    id: "interactive-handoff",
    frozen: decodeInteractiveHandoffV0_26_0,
    frozenStamp: schemaUrl("interactive-handoff", "0.26.0"),
    current: decodeInteractiveHandoffFile,
    fixtures: [
      ["a full handoff", handoff],
      ["nothing from now on", { ...handoff, patternFromNowOn: [], nextPhasesNeedToKnow: [] }],
      [
        "a lint guard",
        { ...handoff, corrections: [{ what: "x", guard: { kind: "lint", ref: "no-foo" } }] },
      ],
      [
        "a gate-step guard",
        {
          ...handoff,
          corrections: [{ what: "x", guard: { kind: "gate-step", ref: "pnpm lint" } }],
        },
      ],
      ["no corrections", { ...handoff, corrections: [] }],
      [
        "an empty what",
        { ...handoff, corrections: [{ what: "", guard: { kind: "none", reason: "r" } }] },
      ],
      [
        "an unknown guard kind",
        { ...handoff, corrections: [{ what: "x", guard: { kind: "review", ref: "r" } }] },
      ],
      [
        "a none guard with no reason",
        { ...handoff, corrections: [{ what: "x", guard: { kind: "none" } }] },
      ],
      [
        "a none guard with an empty reason",
        { ...handoff, corrections: [{ what: "x", guard: { kind: "none", reason: "" } }] },
      ],
      [
        "a test guard with no ref",
        { ...handoff, corrections: [{ what: "x", guard: { kind: "test" } }] },
      ],
      [
        "a test guard with an empty ref",
        { ...handoff, corrections: [{ what: "x", guard: { kind: "test", ref: "" } }] },
      ],
      [
        "a test guard with an extra reason",
        {
          ...handoff,
          corrections: [{ what: "x", guard: { kind: "test", ref: "r", reason: "r" } }],
        },
      ],
      ["an empty pattern item", { ...handoff, patternFromNowOn: [""] }],
      ["no nextPhasesNeedToKnow key", without(handoff, "nextPhasesNeedToKnow")],
      ["an extra root key", { ...handoff, summary: "x" }],
    ],
  },
  {
    id: "code-review",
    frozen: decodeCodeReviewV0_29_0,
    frozenStamp: schemaUrl("code-review", "0.29.0"),
    current: decodeCodeReviewFile,
    fixtures: [
      ["no finding", review()],
      ["one finding", review({})],
      ["a criterion", review({ criterion: "ac-empty-name" })],
      [
        "every severity",
        review({ severity: "info" }, { severity: "concern" }, { severity: "deviation" }),
      ],
      ["an unknown lens", review({ lens: "security" })],
      ["an unknown escape", review({ escape: "flaky" })],
      ["an unknown severity", review({ severity: "critical" })],
      ["line 0", review({ line: 0 })],
      ["a negative line", review({ line: -3 })],
      ["a fractional line", review({ line: 4.5 })],
      ["a string line", review({ line: "42" })],
      ["an empty file", review({ file: "" })],
      ["an empty message", review({ message: "" })],
      ["an empty suggestion", review({ suggestion: "" })],
      ["an empty criterion", review({ criterion: "" })],
      ["a missing criterion", { findings: [without(finding, "criterion")] }],
      ["a missing suggestion", { findings: [without(finding, "suggestion")] }],
      ["an extra finding key", review({ confidence: 0.9 })],
      ["an extra root key", { ...review(), summary: "x" }],
      ["findings that is not an array", { findings: {} }],
      ["no findings key", {}],
    ],
  },
];

describe.each(ANSWERS)(
  "$id: the strict answer keeps every rule of the shape it replaces",
  (answer) => {
    const stamp = schemaUrl(answer.id, CURRENT_STAMPS[answer.id]);

    it.each(answer.fixtures)("%s", (_name, body) => {
      const frozen = answer.frozen({ $schema: answer.frozenStamp, ...body });
      const current = answer.current({ $schema: stamp, ...body });
      if (Either.isLeft(frozen)) {
        expect(Either.isLeft(current)).toBe(true);
        if (Either.isLeft(current)) {
          // The frozen hand-decision union reports its first member's issue,
          // so only the verdict is shared there; the per-kind table below
          // names the paths.
          if (!answer.id.endsWith("-hand-decision-answer")) {
            expect(firstPath(current.left)).toBe(firstPath(frozen.left));
          }
          if (answer.sameMessage === true) {
            expect(formatFirstViolation(current.left)).toBe(formatFirstViolation(frozen.left));
          }
        }
      } else {
        expect(Either.isRight(current)).toBe(true);
      }
    });

    it("is a table of both verdicts", () => {
      const verdicts = answer.fixtures.map(([, body]) =>
        Either.isLeft(answer.frozen({ $schema: answer.frozenStamp, ...body })),
      );
      expect(verdicts).toContain(true);
      expect(verdicts).toContain(false);
    });
  },
);

// The extraction answer replaces `{ version: 1, run, phases }` and `{ error }`:
// its fixtures record the verdicts those two had, in the new format.
describe("phax-plan-extraction: keeps the verdicts of the extraction answer it replaces", () => {
  const stamp = schemaUrl("phax-plan-extraction", CURRENT_STAMPS["phax-plan-extraction"]);
  const phase = {
    id: "phase-01",
    model: "claude-sonnet-5-5",
    effort: "medium",
    planMarkdownAnchor: "#phase-01-first",
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    testLines: [],
    commit: { subject: "feat: x", body: "Body." },
  };
  const line = {
    guarantee: "the first thing is done",
    size: "small",
    technique: "example",
    oracle: "the first thing",
    loop: "in-phase",
    criterion: "ac-first",
  };
  const run = { shortName: "my-run", title: "My Run", requiredCommands: [] };
  const plan = (
    overrides: Record<string, unknown> = {},
    phaseOverrides: Record<string, unknown> = {},
  ) => ({
    $schema: stamp,
    plan: { run, phases: [{ ...phase, ...phaseOverrides }], ...overrides },
    incomplete: null,
  });

  const fixtures: ReadonlyArray<readonly [string, unknown, string | null]> = [
    ["a plan", plan(), null],
    ["a plan with a test line", plan({}, { testLines: [line] }), null],
    ["an unslugged short name", plan({ run: { ...run, shortName: "My Run" } }), null],
    ["no phase", plan({ phases: [] }), "plan.phases"],
    ["a phase id off the format", plan({}, { id: "phase-1" }), "plan.phases[0].id"],
    ["an unknown effort", plan({}, { effort: "turbo" }), "plan.phases[0].effort"],
    ["an empty model", plan({}, { model: "" }), "plan.phases[0].model"],
    [
      "an empty commit subject",
      plan({}, { commit: { subject: "", body: "b" } }),
      "plan.phases[0].commit.subject",
    ],
    [
      "a test line size outside its set",
      plan({}, { testLines: [{ ...line, size: "huge" }] }),
      "plan.phases[0].testLines[0].size",
    ],
    ["a phase with no testLines", plan({}, { testLines: undefined }), "plan.phases[0].testLines"],
    ["a phase carrying mode", plan({}, { mode: "headless" }), "plan.phases[0].mode"],
    ["a phase carrying oracle", plan({}, { oracle: null }), "plan.phases[0].oracle"],
    ["a phase carrying a title", plan({}, { title: "First" }), "plan.phases[0].title"],
    [
      "no requiredCommands",
      plan({ run: { shortName: "r", title: "t" } }),
      "plan.run.requiredCommands",
    ],
    [
      "the former error answer, restated",
      { $schema: stamp, plan: null, incomplete: "phase-01 has no commit" },
      null,
    ],
  ];

  it.each(fixtures)("%s", (_name, parsed, refusedAt) => {
    const read = readPlanExtractionAnswer(parsed);
    if (refusedAt === null) {
      expect(Either.isRight(read)).toBe(true);
    } else {
      expect(Either.isLeft(read)).toBe(true);
      if (Either.isLeft(read)) expect(read.left).toContain(refusedAt);
    }
  });
});

// An authoring answer leaves every question open: a non-empty
// arbitratedQuestions is refused at its first entry, now by phax's coherence
// check rather than the schema's maxItems.
describe("an authoring answer with an arbitrated question", () => {
  const arbitrated = {
    ...openQuestion,
    verdict: { ...handVerdict, chosen: "invoice", abandoned: ["day"] },
    history: [],
  };

  it("is refused at its first entry, for a spec and for a plan", () => {
    const authoredSpec = decodeAuthoredSpecDocument({
      ...validDocuments["spec-document"],
      arbitratedQuestions: [arbitrated, arbitrated],
    });
    expect(authoredSpec).toEqual(
      Either.left(`arbitratedQuestions[0]: ${AUTHORING_ARBITRATED_MESSAGE}`),
    );
    const authoredPlan = decodeAuthoredPlanDocument({
      ...validDocuments["plan-document"],
      preamble: { ...(planBody["preamble"] as Body), arbitratedQuestions: [arbitrated] },
    });
    expect(authoredPlan).toEqual(
      Either.left(`preamble.arbitratedQuestions[0]: ${AUTHORING_ARBITRATED_MESSAGE}`),
    );
  });

  it("is checked before the schema, so a broken entry is still named by the authoring rule", () => {
    const authored = decodeAuthoredSpecDocument({
      ...validDocuments["spec-document"],
      arbitratedQuestions: [{}],
    });
    expect(authored).toEqual(
      Either.left(`arbitratedQuestions[0]: ${AUTHORING_ARBITRATED_MESSAGE}`),
    );
  });
});

// Each kind's format is exact: a spec verdict has no phase, a plan verdict
// needs one, and each is refused naming the key.
describe("the hand decision answers' verdict phase", () => {
  it.each([
    [
      "a spec verdict carrying a phase",
      decodeSpecHandDecisionAnswerFile,
      "spec-hand-decision-answer",
      planHand["decisions"],
      { ...specHand },
    ],
    [
      "a plan verdict without one",
      decodePlanHandDecisionAnswerFile,
      "plan-hand-decision-answer",
      specHand["decisions"],
      { ...planHand },
    ],
  ] as const)(
    "refuses %s, naming decisions[0].verdict.phase",
    (_name, decode: Decode, id, decisions, body) => {
      const decoded = decode({ $schema: schemaUrl(id, CURRENT_STAMPS[id]), ...body, decisions });
      expect(Either.isLeft(decoded)).toBe(true);
      if (Either.isLeft(decoded))
        expect(firstPath(decoded.left)).toBe("decisions[0].verdict.phase");
    },
  );
});

// The test line's lookahead and stacked patterns became one lookaround-free
// pattern plus coherence filters: the frozen 0.28.0 module and the new schema
// agree on every edge string, on every coordinate, verdict and message alike.
describe("a test line's edge strings", () => {
  const EDGES: ReadonlyArray<readonly [string, string]> = [
    ["empty", ""],
    ["one char", "x"],
    ["a leading space", " the output"],
    ["a trailing space", "the output "],
    ["a leading tab", "\tthe output"],
    ["a line separator", "the\u2028output"],
    ["a next line", "the\u0085output"],
    ["a line feed", "the\noutput"],
    ["an inner ' — '", "a — b"],
    ["a leading '— '", "— the output"],
    ["a trailing ' ·'", "the output ·"],
    ["a backtick", "`ac`"],
    ["oracle", "oracle"],
    ["in-phase", "in-phase"],
    ["a plain id", "ac-one"],
  ];
  const COORDINATES = ["guarantee", "oracle", "criterion"] as const;
  const rows = COORDINATES.flatMap((coordinate) =>
    EDGES.map(([name, value]) => [coordinate, name, value] as const),
  );

  it.each(rows)("%s: %s", (coordinate, _name, value) => {
    const body = withTestLine(coordinate, value);
    const frozen = decodePlanDocumentV0_28_0({
      $schema: schemaUrl("plan-document", "0.28.0"),
      ...body,
    });
    const current = decodePlanDocumentFile({
      $schema: validDocuments["plan-document"]["$schema"],
      ...body,
    });
    expect(Either.isLeft(current)).toBe(Either.isLeft(frozen));
    if (Either.isLeft(frozen) && Either.isLeft(current)) {
      expect(formatFirstViolation(current.left)).toBe(formatFirstViolation(frozen.left));
    }
  });

  it("holds both verdicts on every coordinate", () => {
    for (const coordinate of COORDINATES) {
      const verdicts = EDGES.map(([, value]) =>
        Either.isLeft(
          decodePlanDocumentFile({
            $schema: validDocuments["plan-document"]["$schema"],
            ...withTestLine(coordinate, value),
          }),
        ),
      );
      expect(verdicts, coordinate).toContain(true);
      expect(verdicts, coordinate).toContain(false);
    }
  });
});
