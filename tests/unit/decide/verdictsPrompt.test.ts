import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { type Doctrine, assembleDoctrine } from "../../../src/domain/decide/doctrine.js";
import { buildVerdictsPrompt } from "../../../src/domain/decide/verdictsPrompt.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import {
  BOUND_FOLLOW,
  BOUND_HAND_Q1,
  BOUND_KEEP_20,
  BOUND_NAMES_OTHER,
  BOUND_PLAN_Q1,
  BOUND_REARBITRATE_KEEP_20,
  HAND_SPEC_MD,
  PLAN,
  SPEC,
  SPEC_KEEP_DECIDED,
  SPEC_PATH,
} from "./verdictsFixtures.js";

// The verdicts-mode writer prompt (spec artifact-decide-verdicts §5.6, §5.7).
// The spec, the verdicts and the doctrine are made up.

function doctrine(): Doctrine {
  const assembled = assembleDoctrine({
    skill: {
      name: "phax-decide-spec",
      source: "bundled",
      text: "# Spec doctrine\n\n- `S1` **Adopt the recommendation.**\n- `S2` **Argue the other side.**\n",
    },
    file: null,
  });
  if (Either.isLeft(assembled)) throw new Error(assembled.left);
  return assembled.right;
}

const SPEC_URL = currentSchemaUrl("spec-document");

function specPrompt(bound = BOUND_FOLLOW, document = SPEC): string {
  return buildVerdictsPrompt({
    kind: "spec",
    artifactPath: SPEC_PATH,
    doctrine: doctrine(),
    bound,
    authoring: { variant: "headless", document },
    schemaUrl: SPEC_URL,
  });
}

describe("buildVerdictsPrompt — a headless spec", () => {
  const prompt = specPrompt();

  it("is the same text for the same input", () => {
    expect(specPrompt()).toBe(prompt);
  });

  it("states the role: transcribe, decide nothing, write no file", () => {
    expect(prompt).toContain("You transcribe verdicts a person has already made");
    expect(prompt).toContain("you decide nothing");
    expect(prompt).toContain("Never write a file, and never run a command that changes");
  });

  it("has no framing question and no interactive ending", () => {
    expect(prompt).not.toMatch(/- F[1-5]:/);
    expect(prompt).not.toContain("Framing");
    expect(prompt).not.toContain("exit the session");
  });

  it("gives each verdict with its options, abandons, recommendation, choice and note", () => {
    expect(prompt).toContain("### q-keep — How many logs does rotation keep?");
    expect(prompt).toContain("- keep-10 — Ten logs — abandons: a longer history");
    expect(prompt).toContain("- keep-20 — Twenty logs — abandons: disk space");
    expect(prompt).toContain("Recommendation: keep-10");
    expect(prompt).toContain("Chosen: keep-10 — it follows the recommendation");
    expect(prompt).toContain("Note: Ten logs cover a week of runs.");
    // q-scope has no note: phax uses the rationale.
    expect(prompt).toContain("### q-scope — What does one rotation cover?");
    expect(prompt).toContain(
      "Note: none — phax sets this verdict's `why` to the question's rationale.",
    );
  });

  it("gives the verdicts in the order they are bound, and names the question left open", () => {
    expect(prompt.indexOf("### q-keep —")).toBeLessThan(prompt.indexOf("### q-scope —"));
    expect(prompt).not.toContain("### q-names —");
    expect(prompt).toContain("q-names stays open");
  });

  it("lists only the loaded principle ids", () => {
    expect(prompt).toContain("only ids the doctrine below defines (S1, S2)");
  });

  it("asks for the whole document, $schema first at the current stamp, and says phax sets why, by and at", () => {
    expect(prompt).toContain(`set to \`${SPEC_URL}\``);
    expect(prompt).toContain("phax sets each verdict's `why`, `by` and `at` itself");
    expect(prompt).toContain("`openQuestions`");
    expect(prompt).toContain("`arbitratedQuestions`");
    expect(prompt).toContain("`revised: []`");
  });

  it("closes with the doctrine, the document and the answer's JSON Schema, in that order", () => {
    const doctrineAt = prompt.indexOf("## Doctrine");
    const documentAt = prompt.indexOf("## The spec document");
    const schemaAt = prompt.indexOf("## Revised spec document JSON Schema");
    expect(doctrineAt).toBeGreaterThan(prompt.indexOf("## 6. Your answer"));
    expect(documentAt).toBeGreaterThan(doctrineAt);
    expect(schemaAt).toBeGreaterThan(documentAt);
    expect(prompt).toContain("# Spec doctrine");
  });
});

describe("buildVerdictsPrompt — departures", () => {
  it("names the body revisions a departing verdict implies, in revised", () => {
    const prompt = specPrompt(BOUND_KEEP_20);
    expect(prompt).toContain("Chosen: keep-20 — it departs from the recommendation");
    expect(prompt).toContain("Note: Support asks for a fortnight of runs.");
    expect(prompt).toContain("keeping traceability");
    expect(prompt).toContain("name each revised section in `revised`");
  });

  it("tells the writer to apply an `other` choice from the note and never add an option", () => {
    const prompt = specPrompt(BOUND_NAMES_OTHER);
    expect(prompt).toContain("Chosen: other — a choice off the menu");
    expect(prompt).toContain("apply the choice the note describes; never add an option");
  });

  it("shows an arbitrated question's current verdict and says the new one replaces it", () => {
    const prompt = specPrompt(BOUND_REARBITRATE_KEEP_20, SPEC_KEEP_DECIDED);
    expect(prompt).toContain("Current verdict (decided, by the operator (Grace Hopper)");
    expect(prompt).toContain("being re-arbitrated");
    expect(prompt).toContain("moves to the end of its `history`");
  });
});

describe("buildVerdictsPrompt — a headless plan", () => {
  const prompt = buildVerdictsPrompt({
    kind: "plan",
    artifactPath: "docs/plans/2610250900-log-rotation-plan.md",
    doctrine: doctrine(),
    bound: BOUND_PLAN_Q1,
    authoring: { variant: "headless", document: PLAN },
    schemaUrl: currentSchemaUrl("plan-document"),
  });

  it("asks each verdict for its phase and points at the preamble's arrays", () => {
    expect(prompt).toContain("- phase: the id of the plan phase the verdict bears on;");
    expect(prompt).toContain("`preamble.openQuestions`");
    expect(prompt).toContain("`preamble.arbitratedQuestions`");
    expect(prompt).toContain("## Revised plan document JSON Schema");
  });
});

describe("buildVerdictsPrompt — a hand-authored spec", () => {
  const prompt = buildVerdictsPrompt({
    kind: "spec",
    artifactPath: "docs/specs/2610250900-log-retention.md",
    doctrine: doctrine(),
    bound: BOUND_HAND_Q1,
    authoring: { variant: "hand", markdown: HAND_SPEC_MD },
    schemaUrl: currentSchemaUrl("hand-decision-answer"),
  });

  it("asks for a hand decision answer: its decisions and the Markdown unchanged", () => {
    expect(prompt).toContain("hand decision answer JSON Schema");
    expect(prompt).toContain(`set to \`${currentSchemaUrl("hand-decision-answer")}\``);
    expect(prompt).toContain("exactly one `{ id, verdict }` per verdict above (Q1)");
    expect(prompt).toContain("When no verdict departs, return the Markdown unchanged.");
    expect(prompt).not.toContain("## Revised spec document JSON Schema");
  });

  it("points at the question in the Markdown and carries the artifact below it", () => {
    expect(prompt).toContain("### Q1");
    expect(prompt).toContain("under `### Q1 — …` in the artifact below");
    expect(prompt).toContain("```markdown");
    expect(prompt).toContain("### Q1 — Retention: ten logs or twenty?");
  });
});
