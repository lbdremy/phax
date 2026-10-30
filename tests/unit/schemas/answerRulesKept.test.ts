// The strict answers keep every rule of the shapes they replace. For each
// answer, a table of fixtures is decoded by the frozen module of today's shape
// (first-reading and interactive-handoff 0.26.0, code-review 0.29.0) and by the
// new decoder: a fixture the frozen module refuses, the new decoder refuses
// naming the same field; a fixture it accepts, the new decoder accepts once
// restamped with the `$schema` const. The extraction format has no frozen
// module: its fixtures record the verdicts of the answer it replaces. The
// stricter parts — the `$schema` const, the unknown `version` — are covered in
// their own tests.
import { Either, ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { decodeCodeReviewFile } from "../../../src/schemas/codeReview.js";
import { decodeFirstReadingFile } from "../../../src/schemas/firstReading.js";
import { decodeCodeReviewV0_29_0 } from "../../../src/schemas/history/code-review/0.29.0.js";
import { decodeFirstReadingV0_26_0 } from "../../../src/schemas/history/first-reading/0.26.0.js";
import { decodeInteractiveHandoffV0_26_0 } from "../../../src/schemas/history/interactive-handoff/0.26.0.js";
import { decodeInteractiveHandoffFile } from "../../../src/schemas/interactiveHandoff.js";
import { readPlanExtractionAnswer } from "../../../src/schemas/planExtraction.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl, type FormatId } from "../../../src/schemas/schemaUrl.js";

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

const ANSWERS: ReadonlyArray<Answer> = [
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
        if (Either.isLeft(current)) expect(firstPath(current.left)).toBe(firstPath(frozen.left));
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
