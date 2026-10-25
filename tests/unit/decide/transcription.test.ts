import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { parseHandAuthoredQuestions } from "../../../src/domain/artifact/questions.js";
import type { SidecarDocument } from "../../../src/domain/artifact/sidecar.js";
import {
  type BoundVerdicts,
  checkHandTranscription,
  checkTranscription,
} from "../../../src/domain/decide/verdicts.js";
import type { SpecDocument } from "../../../src/schemas/specDocument.js";
import {
  ANSWER_ADDS_OPTION,
  ANSWER_CITES_S12,
  ANSWER_DEPARTS,
  ANSWER_DEPARTS_WITHOUT_REVISED,
  ANSWER_EDITS_BODY,
  ANSWER_FOLLOW,
  ANSWER_FOLLOW_WITH_REVISED,
  ANSWER_MOVES_NAMES,
  ANSWER_OTHER,
  ANSWER_PLAN_PHASE_02,
  ANSWER_PLAN_PHASE_07,
  ANSWER_REARBITRATE_KEEP_20,
  ANSWER_REARBITRATE_SAME,
  ANSWER_WRITER_STAMPS,
  ANSWER_WRONG_OPTION,
  AT_ISO,
  BOUND_FOLLOW,
  BOUND_HAND_Q1,
  BOUND_KEEP_20,
  BOUND_KEEP_FOLLOWS,
  BOUND_NAMES_OTHER,
  BOUND_PLAN_Q1,
  BOUND_REARBITRATE_KEEP_20,
  BOUND_REARBITRATE_SAME,
  HAND_ANSWER_Q1,
  HAND_ANSWER_WRONG_OPTION,
  HAND_PARSED,
  HAND_SPEC_MD,
  OPERATOR,
  PLAN,
  PREVIOUS_KEEP,
  PRINCIPLE_IDS,
  SPEC,
  SPEC_KEEP_DECIDED,
  TRANSCRIBED_FOLLOW,
  TRANSCRIBED_HAND_Q1,
} from "./verdictsFixtures.js";

// What a writer's transcription of a verdicts file must satisfy (spec
// artifact-decide-verdicts §5.10, §5.13–§5.16, §5.26): the checks over a
// headless document and over a hand decision answer. Every `bound` input is a
// literal from the fixtures, so no oracle depends on binding. Every test is an
// oracle for the implementation that follows: it is expected to fail until
// then. Assertions are facts (paths and ids), never full wording.

function check(original: SidecarDocument, answer: unknown, bound: BoundVerdicts) {
  return checkTranscription({
    original,
    answer,
    bound,
    operator: OPERATOR,
    atIso: AT_ISO,
    principleIds: PRINCIPLE_IDS,
  });
}

function checkHand(answer: unknown, bound: BoundVerdicts) {
  return checkHandTranscription({
    kind: "spec",
    md: HAND_SPEC_MD,
    parsed: HAND_PARSED,
    answer,
    bound,
    operator: OPERATOR,
    atIso: AT_ISO,
    principleIds: PRINCIPLE_IDS,
    phaseIds: [],
  });
}

function landed(original: SidecarDocument, answer: unknown, bound: BoundVerdicts) {
  const checked = check(original, answer, bound);
  if (Either.isLeft(checked))
    throw new Error(`expected a document, got ${JSON.stringify(checked.left)}`);
  return checked.right;
}

function refusalOf(original: SidecarDocument, answer: unknown, bound: BoundVerdicts) {
  const checked = check(original, answer, bound);
  if (Either.isRight(checked)) throw new Error("expected a refusal");
  return checked.left;
}

function specOf(sidecar: SidecarDocument): SpecDocument {
  if (sidecar.kind !== "spec") throw new Error("expected a spec");
  return sidecar.document;
}

function arbitratedOf(sidecar: SidecarDocument, id: string) {
  const found = specOf(sidecar).arbitratedQuestions.find((q) => q.id === id);
  if (found === undefined) throw new Error(`${id} is not arbitrated`);
  return found;
}

function decidedOf(sidecar: SidecarDocument, id: string) {
  const { verdict } = arbitratedOf(sidecar, id);
  if (verdict.kind !== "decided") throw new Error(`${id} is not decided`);
  return verdict;
}

describe("a valid transcription", () => {
  it.fails("lands each named question as arbitrated, as given, and leaves the others open", () => {
    const { document, verdicts } = landed(SPEC, ANSWER_FOLLOW, BOUND_FOLLOW);
    const spec = specOf(document);
    expect(spec.arbitratedQuestions.map((q) => q.id)).toEqual(["q-keep", "q-scope"]);
    expect(spec.openQuestions.map((q) => q.id)).toEqual(["q-names"]);
    expect(decidedOf(document, "q-keep")).toMatchObject({
      chosen: "keep-10",
      abandoned: ["keep-20"],
    });
    expect(decidedOf(document, "q-scope")).toMatchObject({
      chosen: "per-run",
      abandoned: ["per-day"],
    });
    expect(verdicts).toEqual(TRANSCRIBED_FOLLOW);
  });

  it.fails("lands the note as the why, and the rationale when there is no note", () => {
    const { document } = landed(SPEC, ANSWER_FOLLOW, BOUND_FOLLOW);
    expect(decidedOf(document, "q-keep").why).toBe("Ten logs cover a week of runs.");
    expect(decidedOf(document, "q-scope").why).toBe(
      "A report names its run, so a log is kept with its run.",
    );
  });

  it.fails("sets why, by and at over whatever the writer returned", () => {
    const { document, verdicts } = landed(SPEC, ANSWER_WRITER_STAMPS, BOUND_FOLLOW);
    for (const id of ["q-keep", "q-scope"]) {
      expect(decidedOf(document, id)).toMatchObject({
        by: { kind: "operator", name: OPERATOR.name },
        at: AT_ISO,
      });
    }
    expect(decidedOf(document, "q-keep").why).toBe("Ten logs cover a week of runs.");
    expect(verdicts).toEqual(TRANSCRIBED_FOLLOW);
  });

  it.fails("leaves every field outside the question arrays as it was when every verdict follows", () => {
    const { document } = landed(SPEC, ANSWER_FOLLOW, BOUND_FOLLOW);
    const { openQuestions: _open, arbitratedQuestions: _arbitrated, ...rest } = specOf(document);
    const { openQuestions: _o, arbitratedQuestions: _a, ...original } = specOf(SPEC);
    expect(rest).toEqual(original);
  });

  it.fails("keeps an unnamed open question exactly as it was", () => {
    const { document } = landed(SPEC, ANSWER_FOLLOW, BOUND_FOLLOW);
    expect(specOf(document).openQuestions).toEqual(
      specOf(SPEC).openQuestions.filter((q) => q.id === "q-names"),
    );
  });
});

describe("a transcription is refused (§5.15)", () => {
  const refusals: ReadonlyArray<
    readonly [string, SidecarDocument, unknown, BoundVerdicts, string]
  > = [
    [
      "a different option than the one given",
      SPEC,
      ANSWER_WRONG_OPTION,
      BOUND_KEEP_20,
      "arbitratedQuestions[0].verdict.chosen",
    ],
    [
      "moving a question the file does not name",
      SPEC,
      ANSWER_MOVES_NAMES,
      BOUND_KEEP_FOLLOWS,
      "arbitratedQuestions[1].id",
    ],
    [
      "editing the body while every verdict follows",
      SPEC,
      ANSWER_EDITS_BODY,
      BOUND_KEEP_FOLLOWS,
      "requirements[0].statement",
    ],
    [
      "citing a principle the doctrine does not define",
      SPEC,
      ANSWER_CITES_S12,
      BOUND_KEEP_FOLLOWS,
      "arbitratedQuestions[0].verdict.principles[0]",
    ],
    [
      "a departing verdict that names no revised section",
      SPEC,
      ANSWER_DEPARTS_WITHOUT_REVISED,
      BOUND_KEEP_20,
      "arbitratedQuestions[0].verdict.revised",
    ],
    [
      "a following verdict that names a revised section",
      SPEC,
      ANSWER_FOLLOW_WITH_REVISED,
      BOUND_KEEP_FOLLOWS,
      "arbitratedQuestions[0].verdict.revised",
    ],
  ];

  it.fails.each(refusals)(
    "refuses %s, at the violating path",
    (_name, original, answer, bound, path) => {
      expect(refusalOf(original, answer, bound).path).toBe(path);
    },
  );

  it.fails("names the unlisted principle it refuses", () => {
    expect(refusalOf(SPEC, ANSWER_CITES_S12, BOUND_KEEP_FOLLOWS).message).toContain("S12");
  });

  it.fails("refuses an option added to a question, naming the question's options", () => {
    const refusal = refusalOf(SPEC, ANSWER_ADDS_OPTION, BOUND_NAMES_OTHER);
    expect(refusal.path).toMatch(/^arbitratedQuestions\[0\]\.(options|verdict\.chosen)/);
    expect(refusal.message).toContain("by-date");
    expect(refusal.message).toContain("by-run");
  });

  it.fails("refuses an answer that is not stamped with the document's current shape", () => {
    const { $schema: _schema, ...unstamped } = ANSWER_FOLLOW as Record<string, unknown>;
    expect(refusalOf(SPEC, unstamped, BOUND_FOLLOW).path).toBe("$schema");
  });
});

describe("a departing verdict", () => {
  it.fails("lands with the note as its why and the sections it revised", () => {
    const { document, verdicts } = landed(SPEC, ANSWER_DEPARTS, BOUND_KEEP_20);
    expect(decidedOf(document, "q-keep")).toMatchObject({
      chosen: "keep-20",
      abandoned: ["keep-10"],
      why: "Support asks for a fortnight of runs.",
      revised: ["5.1", "AC-1"],
      by: { kind: "operator", name: OPERATOR.name },
      at: AT_ISO,
    });
    expect(verdicts).toEqual([
      {
        question: "q-keep",
        chosen: "keep-20",
        recommendation: "keep-10",
        departs: true,
        why: "Support asks for a fortnight of runs.",
        revised: ["5.1", "AC-1"],
        by: { kind: "operator", name: OPERATOR.name },
      },
    ]);
  });
});

describe("other", () => {
  it.fails("lands chosen other, every listed option abandoned and the note as its why", () => {
    const { document, verdicts } = landed(SPEC, ANSWER_OTHER, BOUND_NAMES_OTHER);
    expect(decidedOf(document, "q-names")).toMatchObject({
      chosen: "other",
      abandoned: ["by-date", "by-run"],
      why: "Name each log by its date and its phase.",
    });
    expect(decidedOf(document, "q-names").revised.length).toBeGreaterThan(0);
    expect(verdicts.map((v) => [v.question, v.chosen, v.departs])).toEqual([
      ["q-names", "other", true],
    ]);
  });

  it.fails("leaves the question's options unchanged, with no other among them", () => {
    const { document } = landed(SPEC, ANSWER_OTHER, BOUND_NAMES_OTHER);
    const options = arbitratedOf(document, "q-names").options;
    expect(options).toEqual(specOf(SPEC).openQuestions.find((q) => q.id === "q-names")?.options);
    expect(options.map((o) => o.id)).not.toContain("other");
  });
});

describe("a re-arbitrated question", () => {
  it.fails("lands the new verdict with the previous one at the end of its history", () => {
    const { document } = landed(
      SPEC_KEEP_DECIDED,
      ANSWER_REARBITRATE_KEEP_20,
      BOUND_REARBITRATE_KEEP_20,
    );
    const question = arbitratedOf(document, "q-keep");
    expect(question.verdict).toMatchObject({
      chosen: "keep-20",
      by: { kind: "operator", name: OPERATOR.name },
      at: AT_ISO,
    });
    expect(question.history).toEqual([PREVIOUS_KEEP]);
  });

  it.fails("leaves every other question as it was", () => {
    const { document } = landed(
      SPEC_KEEP_DECIDED,
      ANSWER_REARBITRATE_KEEP_20,
      BOUND_REARBITRATE_KEEP_20,
    );
    expect(specOf(document).openQuestions).toEqual(specOf(SPEC_KEEP_DECIDED).openQuestions);
  });

  it.fails("appends the previous verdict to the history even when the choice is the same", () => {
    const { document, verdicts } = landed(
      SPEC_KEEP_DECIDED,
      ANSWER_REARBITRATE_SAME,
      BOUND_REARBITRATE_SAME,
    );
    const question = arbitratedOf(document, "q-keep");
    expect(question.verdict).toMatchObject({ chosen: "keep-10", at: AT_ISO });
    expect(question.history).toEqual([PREVIOUS_KEEP]);
    expect(verdicts.map((v) => v.question)).toEqual(["q-keep"]);
  });
});

describe("a plan's verdict", () => {
  it.fails("lands bearing on a phase of the plan", () => {
    const { document } = landed(PLAN, ANSWER_PLAN_PHASE_02, BOUND_PLAN_Q1);
    if (document.kind !== "plan") throw new Error("expected a plan");
    const [question] = document.document.preamble.arbitratedQuestions;
    expect(question?.id).toBe("Q1");
    expect(question?.verdict).toMatchObject({
      kind: "decided",
      phase: "phase-02",
      chosen: "one-pass",
    });
    expect(document.document.preamble.openQuestions.map((q) => q.id)).toEqual(["Q2"]);
  });

  it.fails("restores the plan's lineage over whatever the writer returned", () => {
    const { document } = landed(PLAN, ANSWER_PLAN_PHASE_02, BOUND_PLAN_Q1);
    if (document.kind !== "plan" || PLAN.kind !== "plan") throw new Error("expected a plan");
    expect(document.document.sourceSpec).toBe(PLAN.document.sourceSpec);
    expect(document.document.completesSpec).toBe(PLAN.document.completesSpec);
  });

  it.fails("refuses a phase the plan does not have, at the verdict's phase", () => {
    const refusal = refusalOf(PLAN, ANSWER_PLAN_PHASE_07, BOUND_PLAN_Q1);
    expect(refusal.path).toBe("preamble.arbitratedQuestions[0].verdict.phase");
    expect(refusal.message).toContain("phase-07");
  });
});

describe("a hand decision answer", () => {
  function handLanded(answer: unknown, bound: BoundVerdicts) {
    const checked = checkHand(answer, bound);
    if (Either.isLeft(checked))
      throw new Error(`expected an answer, got ${JSON.stringify(checked.left)}`);
    return checked.right;
  }

  it.fails("lands the named question in the arbitrated section and leaves the other open", () => {
    const { md, verdicts } = handLanded(HAND_ANSWER_Q1, BOUND_HAND_Q1);
    const parsed = parseHandAuthoredQuestions("spec", md);
    if (parsed.kind !== "parsed") throw new Error("the written Markdown does not parse");
    expect(parsed.open.map((q) => q.id)).toEqual(["Q2"]);
    expect(parsed.arbitrated.map((q) => [q.id, q.chosen])).toEqual([["Q1", "keep-10"]]);
    expect(verdicts).toEqual(TRANSCRIBED_HAND_Q1);
  });

  it.fails("writes the Decision block and one decision-log entry for the named question", () => {
    const { md } = handLanded(HAND_ANSWER_Q1, BOUND_HAND_Q1);
    expect(md).toContain("Decision: keep-10 — by operator (Ada Lovelace), 2026-10-25");
    const entries = md.split("\n").filter((line) => /\bQ\d+ decided\b/.test(line));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("Q1 decided keep-10");
  });

  it.fails("sets why, by and at on the decoded answer over whatever the writer returned", () => {
    const { answer } = handLanded(HAND_ANSWER_Q1, BOUND_HAND_Q1);
    expect(answer.decisions.map((d) => d.id)).toEqual(["Q1"]);
    expect(answer.decisions[0]?.verdict).toMatchObject({
      kind: "decided",
      chosen: "keep-10",
      by: { kind: "operator", name: OPERATOR.name },
      at: AT_ISO,
    });
    expect(answer.decisions[0]?.verdict.why).toBe(BOUND_HAND_Q1.verdicts[0]?.why);
  });

  it.fails("refuses an answer choosing another option than the one given", () => {
    const checked = checkHand(HAND_ANSWER_WRONG_OPTION, BOUND_HAND_Q1);
    if (Either.isRight(checked)) throw new Error("expected a refusal");
    expect(checked.left.path).toBe("decisions[0].verdict.chosen");
  });
});
