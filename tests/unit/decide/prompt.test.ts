import { Either } from "effect";
import { describe, expect, it } from "vitest";
import type { SidecarDocument } from "../../../src/domain/artifact/sidecar.js";
import { type Doctrine, assembleDoctrine } from "../../../src/domain/decide/doctrine.js";
import {
  FRAMING_QUESTIONS,
  buildDecidePrompt,
  buildDecideRetryPrompt,
  buildHandbackPrompt,
  positionalPrompt,
} from "../../../src/domain/decide/prompt.js";
import { type DecideScope, questionsOf } from "../../../src/domain/decide/revision.js";
import type { OpenQuestion } from "../../../src/schemas/questions.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import type { SpecDocument } from "../../../src/schemas/specDocument.js";

// The decide prompts (spec artifact-decide §5.1, §5.10, §5.14, §5.33). The
// spec, the questions and the doctrine are made up.

function question(id: string): OpenQuestion {
  return {
    id,
    question: `Where do the ${id} logs go?`,
    options: [
      { id: `${id}-keep`, label: "Keep them", abandons: "disk space" },
      { id: `${id}-drop`, label: "Drop them", abandons: "the history" },
    ],
    recommendation: `${id}-keep`,
    rationale: "history is cheap",
  };
}

const DOCUMENT: SpecDocument = {
  kind: "spec",
  title: "Log rotation",
  ground: [],
  context: "Every run writes one log.",
  problem: "Logs pile up.",
  productGoal: { statement: "Keep logs bounded.", guidingRule: "A log is kept while useful." },
  terminology: [],
  requirements: [
    {
      id: "5.1",
      title: "Rotate",
      pattern: "event",
      statement: "WHEN a run ends THE system SHALL rotate its log.",
    },
  ],
  surface: [],
  nonGoals: [],
  acceptanceCriteria: [
    {
      id: "AC-1",
      name: "Logs rotate",
      given: "a finished run",
      when: "its log is rotated",
      // oxlint-disable-next-line unicorn/no-thenable -- given/when/then data, never awaited
      then: "the log directory stays bounded",
      refs: ["5.1"],
    },
  ],
  openQuestions: [question("Q-old"), question("Q-new")],
  arbitratedQuestions: [
    {
      ...question("Q-done"),
      verdict: {
        kind: "decided",
        chosen: "Q-done-drop",
        abandoned: ["Q-done-keep"],
        why: "nobody reads them",
        advocate: "an audit might",
        principles: ["S1"],
        reversibility: "costly",
        by: { kind: "operator", name: "Ada Lovelace" },
        at: "2026-10-01T10:00:00Z",
        revised: ["§5.1"],
      },
      history: [],
    },
  ],
  planningNote: { settled: [], open: [], constraints: [] },
  docsPage: { kind: "none", why: "the CLI reference covers it" },
};

const SIDECAR: SidecarDocument = { kind: "spec", document: DOCUMENT };

function doctrine(): Doctrine {
  const assembled = assembleDoctrine({
    skill: {
      name: "phax-decide-spec",
      source: "bundled",
      text: "# Spec doctrine\n\n- `S1` **Adopt the recommendation.**\n- `S2` **Argue the other side.**\n",
    },
    file: { path: "docs/doctrine.md", text: "- `X1` Prefer the cheaper option.\n" },
  });
  if (Either.isLeft(assembled)) throw new Error(assembled.left);
  return assembled.right;
}

function prompt(scope: DecideScope, kind: "spec" = "spec"): string {
  return buildDecidePrompt({
    kind,
    artifactPath: "docs/specs/2609281200-log-rotation.md",
    doctrine: doctrine(),
    scope,
    questions: questionsOf(SIDECAR),
    document: SIDECAR,
  });
}

describe("FRAMING_QUESTIONS", () => {
  it("words F1–F5 as the spec defines them", () => {
    expect(FRAMING_QUESTIONS.map((f) => f.id)).toEqual(["F1", "F2", "F3", "F4", "F5"]);
    expect(FRAMING_QUESTIONS[0]?.question).toBe(
      "who consumes this, and what exactly does it read?",
    );
    expect(FRAMING_QUESTIONS[4]?.question).toBe(
      "does the cited doctrine still say what the operator intends?",
    );
  });
});

describe("buildDecidePrompt", () => {
  const text = prompt({ presented: ["Q-new", "Q-old"], reArbitrated: null });

  it("states the role before anything else", () => {
    expect(text.indexOf("the operator decides")).toBeLessThan(text.indexOf("F1"));
    expect(text).toContain("never run a command that changes the repository");
  });

  it("raises F1–F5 before the presented questions, in scope order", () => {
    const f5 = text.indexOf(`F5: ${FRAMING_QUESTIONS[4]?.question}`);
    const first = text.indexOf("### Q-new — ");
    const second = text.indexOf("### Q-old — ");
    for (const f of FRAMING_QUESTIONS) expect(text).toContain(`${f.id}: ${f.question}`);
    expect(text.indexOf("F1:")).toBeLessThan(f5);
    expect(f5).toBeLessThan(first);
    expect(first).toBeLessThan(second);
  });

  it("presents only the scoped questions", () => {
    expect(text).not.toContain("### Q-done — ");
  });

  it("presents a re-arbitrated question with its current verdict", () => {
    const rearbitrated = prompt({ presented: ["Q-done"], reArbitrated: "Q-done" });
    expect(rearbitrated).toContain("### Q-done — ");
    expect(rearbitrated).toContain("Current verdict (decided, by the operator (Ada Lovelace)");
    expect(rearbitrated).toContain("Q-done-drop — nobody reads them");
    expect(rearbitrated).not.toContain("### Q-old — ");
  });

  it("lists the citable principle ids and asks for revised sections on a departure", () => {
    expect(text).toContain("(S1, S2, X1)");
    expect(text).toContain("requirements, surface, acceptance criteria, planning note");
    expect(text).not.toContain("- phase:");
  });

  it("carries the doctrine text, the sidecar JSON and the answer's JSON Schema, in that order", () => {
    const doctrineAt = text.indexOf("## Project doctrine (docs/doctrine.md)");
    const sidecarAt = text.indexOf(
      `"$schema": "${schemaUrl("spec-document", CURRENT_STAMPS["spec-document"])}"`,
    );
    const schemaAt = text.indexOf("## Revised spec document JSON Schema");
    expect(text).toContain("`S1` **Adopt the recommendation.**");
    expect(doctrineAt).toBeGreaterThan(0);
    expect(sidecarAt).toBeGreaterThan(doctrineAt);
    expect(schemaAt).toBeGreaterThan(sidecarAt);
    expect(text.slice(schemaAt)).toContain('"arbitratedQuestions"');
  });

  it("is deterministic", () => {
    expect(prompt({ presented: ["Q-new", "Q-old"], reArbitrated: null })).toBe(text);
  });
});

describe("buildHandbackPrompt", () => {
  it("asks for the whole revised document, $schema first, decided questions moved", () => {
    const url = schemaUrl("plan-document", CURRENT_STAMPS["plan-document"]);
    const text = buildHandbackPrompt({ kind: "plan", schemaUrl: url });
    expect(text).toContain("final message alone");
    expect(text).toContain(`\`$schema\` first, set to \`${url}\``);
    expect(text).toContain("from `preamble.openQuestions` to `preamble.arbitratedQuestions`");
    expect(text).toContain("phax sets each verdict's `by` and `at`");
    expect(text).toContain("When nothing was decided, return the document unchanged.");
  });
});

describe("buildDecideRetryPrompt", () => {
  it("names the refusal and asks for the whole document again", () => {
    const text = buildDecideRetryPrompt('arbitratedQuestions[0].verdict.chosen: "x" names none');
    expect(text).toContain('Refusal: arbitratedQuestions[0].verdict.chosen: "x" names none');
    expect(text).toContain("Return the whole revised document again");
  });
});

describe("positionalPrompt", () => {
  it("points the session at the prompt file", () => {
    expect(positionalPrompt(".phax-context/decide/2609281200-log-rotation-01/prompt.md")).toBe(
      "Read .phax-context/decide/2609281200-log-rotation-01/prompt.md and follow it.",
    );
  });
});
