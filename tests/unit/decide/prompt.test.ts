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
import type { DecideScope } from "../../../src/domain/decide/revision.js";
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
    authoring: { variant: "headless", document: SIDECAR },
  });
}

// A hand-authored spec: no sidecar, its questions in its §9 sections.
const HAND_SPEC = [
  "---",
  "status: Draft",
  "---",
  "# Log rotation",
  "",
  "## 9. Open questions",
  "",
  "### Q-new — Where do the Q-new logs go?",
  "",
  "- Q-new-keep — Keep them — abandons: disk space",
  "- Q-new-drop — Drop them — abandons: the history",
  "",
  "Recommendation: Q-new-keep — history is cheap",
  "",
  "```sh",
  "ls ```` logs",
  "```",
  "",
].join("\n");

function handPrompt(scope: DecideScope): string {
  return buildDecidePrompt({
    kind: "spec",
    artifactPath: "docs/specs/2609281200-log-rotation.md",
    doctrine: doctrine(),
    scope,
    authoring: { variant: "hand", markdown: HAND_SPEC },
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

  // ac-schema: the revised document's JSON Schema lists the surface summary as required.
  it("lists the surface summary in the revised document's JSON Schema, required right after surface", () => {
    const schemaText = text.slice(text.indexOf("## Revised spec document JSON Schema"));
    const start = schemaText.indexOf("{");
    const schema = JSON.parse(schemaText.slice(start, schemaText.lastIndexOf("}") + 1)) as {
      properties: {
        surface: {
          items: {
            required: string[];
            additionalProperties: boolean;
            properties: Record<string, { type?: string; pattern?: string; description?: string }>;
          };
        };
      };
    };
    const item = schema.properties.surface.items;
    expect(item.required.slice(0, 2)).toEqual(["surface", "summary"]);
    expect(item.additionalProperties).toBe(false);
    expect(item.properties["summary"]).toMatchObject({
      type: "string",
      pattern: "^[^\\n\\r\\u0085\\u2028\\u2029]+$",
    });
    expect(item.properties["summary"]?.description).toContain("in the consumer's words");
  });

  it("is deterministic", () => {
    expect(prompt({ presented: ["Q-new", "Q-old"], reArbitrated: null })).toBe(text);
  });
});

describe("buildDecidePrompt — a hand-authored artifact", () => {
  const text = handPrompt({ presented: ["Q-new"], reArbitrated: null });

  it("raises F1–F5 before naming the presented questions", () => {
    expect(text.indexOf("F5:")).toBeLessThan(text.indexOf("- Q-new — under `### Q-new — …`"));
  });

  it("carries the doctrine, then the Markdown in a fence it cannot close, then the hand decision answer's JSON Schema", () => {
    const doctrineAt = text.indexOf("## Project doctrine (docs/doctrine.md)");
    const markdownAt = text.indexOf("`````markdown\n---\nstatus: Draft");
    const schemaAt = text.indexOf("## Hand decision answer JSON Schema");
    expect(doctrineAt).toBeGreaterThan(0);
    expect(markdownAt).toBeGreaterThan(doctrineAt);
    expect(schemaAt).toBeGreaterThan(markdownAt);
    expect(text).toContain(
      "`## 9. Open questions`, `## 9b. Arbitrated questions` and `## 12. Decision log`",
    );
    expect(text.slice(schemaAt)).toContain(
      schemaUrl("spec-hand-decision-answer", CURRENT_STAMPS["spec-hand-decision-answer"]),
    );
    expect(text.slice(schemaAt)).not.toContain("plan-hand-decision-answer");
    expect(text).not.toContain("## Revised spec document JSON Schema");
  });

  it("points a re-arbitrated question at its current Decision block", () => {
    const rearbitrated = handPrompt({ presented: ["Q-done"], reArbitrated: "Q-done" });
    expect(rearbitrated).toContain("- Q-done — re-arbitrated: its current Decision block");
  });
});

describe("buildHandbackPrompt", () => {
  it("asks a hand-authored artifact for its verdicts and its Markdown, the sections phax writes left as they were", () => {
    const url = schemaUrl("plan-hand-decision-answer", CURRENT_STAMPS["plan-hand-decision-answer"]);
    const text = buildHandbackPrompt({ kind: "plan", variant: "hand", schemaUrl: url });
    expect(text).toContain("final message alone");
    expect(text).toContain(`\`$schema\` first, set to \`${url}\``);
    expect(text).toContain("with a `decided` verdict naming its `phase`");
    expect(text).toContain(
      "Leave its frontmatter, its `## Open questions`, `## Arbitrated questions` and `## Decision log` sections exactly as they were",
    );
    expect(text).toContain("phax sets each verdict's `by` and `at`");
    expect(text).toContain("When nothing was decided, return the Markdown unchanged.");
  });

  it("asks for the whole revised document, $schema first, decided questions moved", () => {
    const url = schemaUrl("plan-document", CURRENT_STAMPS["plan-document"]);
    const text = buildHandbackPrompt({ kind: "plan", variant: "headless", schemaUrl: url });
    expect(text).toContain("final message alone");
    expect(text).toContain(`\`$schema\` first, set to \`${url}\``);
    expect(text).toContain("from `preamble.openQuestions` to `preamble.arbitratedQuestions`");
    expect(text).toContain("phax sets each verdict's `by` and `at`");
    expect(text).toContain("When nothing was decided, return the document unchanged.");
  });
});

describe("buildDecideRetryPrompt", () => {
  it("names the refusal and asks for the whole document again", () => {
    const text = buildDecideRetryPrompt(
      "headless",
      'arbitratedQuestions[0].verdict.chosen: "x" names none',
    );
    expect(text).toContain("Your revised document was refused");
    expect(text).toContain('Refusal: arbitratedQuestions[0].verdict.chosen: "x" names none');
    expect(text).toContain("Return the whole revised document again");
  });

  it("asks a hand-authored artifact's session for its hand decision answer again", () => {
    const text = buildDecideRetryPrompt("hand", 'decisions[0].id: "Q9" was not presented');
    expect(text).toContain("Your hand decision answer was refused");
    expect(text).toContain('Refusal: decisions[0].id: "Q9" was not presented');
    expect(text).toContain("Return the whole hand decision answer again");
    expect(text).toContain("revised `markdown`");
    expect(text).not.toContain("revised document");
  });
});

describe("positionalPrompt", () => {
  it("points the session at the prompt file", () => {
    expect(positionalPrompt(".phax-context/decide/2609281200-log-rotation-01/prompt.md")).toBe(
      "Read .phax-context/decide/2609281200-log-rotation-01/prompt.md and follow it.",
    );
  });
});
