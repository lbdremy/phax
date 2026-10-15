import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  OpenQuestionSchema,
  firstQuestionViolation,
  liftMarkedQuestions,
  type OpenQuestion,
  type PlanArbitratedQuestion,
  type SpecArbitratedQuestion,
} from "../../../src/schemas/questions.js";

// Made-up questions: a spec `plan-prune` deciding how many archived runs to keep.

function question(id: string, rationale: string, recommendation = "keep-10"): OpenQuestion {
  return {
    id,
    question: `How many archived runs does ${id} keep?`,
    options: [
      { id: "keep-10", label: "ten runs", abandons: "older trajectories" },
      { id: "keep-20", label: "twenty runs", abandons: "a small archive" },
      { id: "keep-all", label: "every run", abandons: "a bounded archive" },
    ],
    recommendation,
    rationale,
  };
}

function lifted(q: OpenQuestion, at = "2026-09-28"): SpecArbitratedQuestion {
  return {
    ...q,
    verdict: {
      kind: "lifted",
      chosen: q.recommendation,
      abandoned: q.options.map((o) => o.id).filter((id) => id !== q.recommendation),
      why: q.rationale,
      at,
      by: { kind: "unattributed" },
    },
    history: [],
  };
}

function decidedPlan(q: OpenQuestion, phase: string): PlanArbitratedQuestion {
  return {
    ...q,
    verdict: {
      kind: "decided",
      chosen: "keep-20",
      abandoned: ["keep-10", "keep-all"],
      why: "twenty covers a release cycle",
      advocate: "ten keeps the archive small",
      principles: ["S2"],
      reversibility: "cheap",
      by: { kind: "operator", name: "Ada Lovelace" },
      at: "2026-10-20T08:02:11Z",
      revised: [],
      phase,
    },
    history: [],
  };
}

function specViolation(
  openQuestions: ReadonlyArray<OpenQuestion>,
  arbitratedQuestions: ReadonlyArray<SpecArbitratedQuestion>,
) {
  return firstQuestionViolation({
    basePath: [],
    openQuestions,
    arbitratedQuestions,
    phaseIds: null,
  });
}

function render(violation: ReturnType<typeof firstQuestionViolation>): string | undefined {
  if (violation === undefined) return undefined;
  const path = violation.path
    .map((key, i) => (typeof key === "number" ? `[${key}]` : `${i === 0 ? "" : "."}${String(key)}`))
    .join("");
  return `${path}: ${violation.message}`;
}

describe("liftMarkedQuestions", () => {
  const q1 = {
    ...question("Q1", "Decided by the author on 2026-09-28, as recommended."),
    question: "Is pruning manual? (Decided by the author on 2026-09-28; not reopened.)",
  };
  const q2 = question("Q2", "ten matches the default keep");
  const q3 = {
    ...question("Q3", "twenty is the usual bound"),
    question: "Where do pruned runs go? (Decided by the author on 2026-09-29; not reopened.)",
  };
  const q4 = question(
    "Q4",
    "Decided by the author on 2026-09-30, against the previous recommendation (`keep-10`).",
    "keep-20",
  );
  const lowercase = question("Q5", "decided by the author on 2026-10-01, as recommended.");

  const lift = liftMarkedQuestions([q1, q2, q3, q4, lowercase]);

  it("lifts a question marked in its rationale, whatever its question says", () => {
    expect(lift.arbitratedQuestions.map((q) => q.id)).toEqual(["Q1", "Q4"]);
  });

  it("keeps open an unmarked question, one marked only in its question, and a lowercase marker, in order", () => {
    expect(lift.openQuestions).toEqual([q2, q3, lowercase]);
  });

  it("chooses the recommendation, even one chosen against an earlier recommendation, dated by the marker", () => {
    const [, q4Lifted] = lift.arbitratedQuestions;
    expect(q4Lifted?.verdict).toMatchObject({ chosen: "keep-20", at: "2026-09-30" });
  });

  it("gives a lifted verdict exactly kind, chosen, abandoned in option order, why, at and by", () => {
    const [q1Lifted] = lift.arbitratedQuestions;
    expect(q1Lifted).toEqual({
      ...q1,
      verdict: {
        kind: "lifted",
        chosen: "keep-10",
        abandoned: ["keep-20", "keep-all"],
        why: "Decided by the author on 2026-09-28, as recommended.",
        at: "2026-09-28",
        by: { kind: "unattributed" },
      },
      history: [],
    });
    expect(Object.keys(q1Lifted?.verdict ?? {})).toEqual([
      "kind",
      "chosen",
      "abandoned",
      "why",
      "at",
      "by",
    ]);
  });

  it("lifts nothing from a document whose questions carry no marker", () => {
    expect(liftMarkedQuestions([q2])).toEqual({ openQuestions: [q2], arbitratedQuestions: [] });
  });

  it("requires the marker at the start of the rationale, untrimmed", () => {
    const indented = question("Q6", " Decided by the author on 2026-10-01.");
    expect(liftMarkedQuestions([indented]).arbitratedQuestions).toEqual([]);
  });
});

describe("firstQuestionViolation", () => {
  const open = question("q-keep", "ten matches the default keep");
  const arbitrated = lifted(question("q-scope", "Decided by the author on 2026-09-28."));

  it("accepts open and arbitrated questions that pass every check", () => {
    expect(specViolation([open], [arbitrated])).toBeUndefined();
  });

  it("refuses a question id duplicated across the two arrays, naming the later one", () => {
    expect(render(specViolation([open], [lifted({ ...open, rationale: "x" })]))).toBe(
      'arbitratedQuestions[0].id: "q-keep" duplicates the question id at openQuestions[0]',
    );
  });

  it("refuses a duplicate option id within an arbitrated question", () => {
    const options = [...arbitrated.options.slice(0, 2), { ...arbitrated.options[0]! }];
    expect(render(specViolation([], [{ ...arbitrated, options }]))).toBe(
      'arbitratedQuestions[0].options[2].id: "keep-10" duplicates the option id at index 0',
    );
  });

  it("refuses an arbitrated question whose recommendation names no option", () => {
    expect(render(specViolation([], [{ ...arbitrated, recommendation: "keep-5" }]))).toBe(
      'arbitratedQuestions[0].recommendation: "keep-5" names none of the question\'s options (keep-10, keep-20, keep-all)',
    );
  });

  it("refuses a chosen option that is not listed", () => {
    const verdict = { ...arbitrated.verdict, chosen: "keep-5" };
    expect(render(specViolation([], [{ ...arbitrated, verdict }]))).toBe(
      'arbitratedQuestions[0].verdict.chosen: "keep-5" names none of the question\'s options (keep-10, keep-20, keep-all)',
    );
  });

  it("refuses an abandoned list missing an option", () => {
    const verdict = { ...arbitrated.verdict, abandoned: ["keep-20"] };
    expect(render(specViolation([], [{ ...arbitrated, verdict }]))).toBe(
      'arbitratedQuestions[0].verdict.abandoned: misses "keep-all": a verdict abandons every option it does not choose',
    );
  });

  it("refuses an abandoned list holding the chosen option", () => {
    const verdict = { ...arbitrated.verdict, abandoned: ["keep-20", "keep-10", "keep-all"] };
    expect(render(specViolation([], [{ ...arbitrated, verdict }]))).toBe(
      'arbitratedQuestions[0].verdict.abandoned[1]: "keep-10" is the chosen option',
    );
  });

  it("refuses an abandoned list holding a duplicate", () => {
    const verdict = { ...arbitrated.verdict, abandoned: ["keep-20", "keep-all", "keep-20"] };
    expect(render(specViolation([], [{ ...arbitrated, verdict }]))).toBe(
      'arbitratedQuestions[0].verdict.abandoned[2]: "keep-20" is abandoned twice',
    );
  });

  it("accepts an abandoned list in reverse option order", () => {
    const verdict = { ...arbitrated.verdict, abandoned: ["keep-all", "keep-20"] };
    expect(specViolation([], [{ ...arbitrated, verdict }])).toBeUndefined();
  });

  it("refuses a history verdict that breaks the same rules", () => {
    const earlier = { ...arbitrated.verdict, chosen: "keep-20", abandoned: ["keep-10"] };
    expect(render(specViolation([], [{ ...arbitrated, history: [earlier] }]))).toBe(
      'arbitratedQuestions[0].history[0].abandoned: misses "keep-all": a verdict abandons every option it does not choose',
    );
  });

  it("refuses a plan decided verdict naming a phase the plan does not have, at its preamble path", () => {
    const violation = firstQuestionViolation({
      basePath: ["preamble"],
      openQuestions: [],
      arbitratedQuestions: [decidedPlan(open, "phase-09")],
      phaseIds: ["phase-01", "phase-02"],
    });
    expect(render(violation)).toBe(
      'preamble.arbitratedQuestions[0].verdict.phase: "phase-09" names none of the plan\'s phases (phase-01, phase-02)',
    );
  });

  it("accepts a plan decided verdict naming one of its phases", () => {
    const violation = firstQuestionViolation({
      basePath: ["preamble"],
      openQuestions: [],
      arbitratedQuestions: [decidedPlan(open, "phase-02")],
      phaseIds: ["phase-01", "phase-02"],
    });
    expect(violation).toBeUndefined();
  });
});

describe("question and option ids", () => {
  const decode = Schema.decodeUnknownEither(OpenQuestionSchema);

  it("accepts ids without whitespace", () => {
    expect(Either.isRight(decode(question("q-keep", "ten is enough")))).toBe(true);
  });

  it("refuses a question id or an option id holding whitespace, which the §9 format cannot read back", () => {
    const base = question("q-keep", "ten is enough");
    expect(Either.isLeft(decode({ ...base, id: "Q 1" }))).toBe(true);
    const [first, ...rest] = base.options;
    expect(
      Either.isLeft(decode({ ...base, options: [{ ...first, id: "keep ten" }, ...rest] })),
    ).toBe(true);
  });
});
