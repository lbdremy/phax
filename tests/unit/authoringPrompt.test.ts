import { describe, expect, it } from "vitest";
import {
  AUTHORING_PROMPT_FILENAME,
  buildAuthoringPrompt,
} from "../../src/domain/authoring/prompt.js";

const JSON_SCHEMA = { title: "phax spec document (experimental)", type: "object" };

function specPrompt(): string {
  return buildAuthoringPrompt({
    kind: "spec",
    skillText: "# phax-spec\n\nSKILL-TEXT-MARKER\n",
    jsonSchema: JSON_SCHEMA,
    brief: "BRIEF-MARKER: prune archived runs.",
    sourceSpec: null,
    completesSpec: null,
    slug: "plan-prune",
  });
}

function planPrompt(completesSpec: boolean): string {
  return buildAuthoringPrompt({
    kind: "plan",
    skillText: "# phax-planning\n",
    jsonSchema: { title: "phax plan document (experimental)" },
    brief: "BRIEF-MARKER",
    sourceSpec: {
      path: "docs/specs/2609091412-plan-prune.md",
      markdown: "---\nstatus: Approved\n---\n# SPEC-BODY-MARKER\n",
    },
    completesSpec,
    slug: "plan-prune",
  });
}

describe("buildAuthoringPrompt", () => {
  it("names the session's prompt file", () => {
    expect(AUTHORING_PROMPT_FILENAME).toBe("prompt.md");
  });

  it("contains the skill text, the JSON Schema and the brief, in that order", () => {
    const prompt = specPrompt();
    const skill = prompt.indexOf("SKILL-TEXT-MARKER");
    const schema = prompt.indexOf('"title": "phax spec document (experimental)"');
    const brief = prompt.indexOf("BRIEF-MARKER");

    expect(skill).toBeGreaterThanOrEqual(0);
    expect(schema).toBeGreaterThan(skill);
    expect(brief).toBeGreaterThan(schema);
  });

  it("states the JSON-only output contract before the schema", () => {
    const prompt = specPrompt();
    const contract = prompt.indexOf("Return ONLY a JSON object");

    expect(contract).toBeGreaterThan(prompt.indexOf("SKILL-TEXT-MARKER"));
    expect(contract).toBeLessThan(prompt.indexOf('"title": "phax spec document'));
    expect(prompt).toContain("No code fences");
    expect(prompt).toContain("Write no files");
    expect(prompt).toContain("final message");
  });

  it("is deterministic", () => {
    expect(specPrompt()).toBe(specPrompt());
  });

  it("a spec prompt carries no source spec", () => {
    expect(specPrompt()).not.toContain("Source spec");
  });

  it("a spec prompt says nothing of completesSpec", () => {
    expect(specPrompt()).not.toContain("completesSpec");
  });

  it("a plan prompt includes the source spec between the schema and the brief", () => {
    const prompt = planPrompt(true);
    const schema = prompt.indexOf('"title": "phax plan document (experimental)"');
    const spec = prompt.indexOf("SPEC-BODY-MARKER");
    const brief = prompt.indexOf("BRIEF-MARKER");

    expect(spec).toBeGreaterThan(schema);
    expect(brief).toBeGreaterThan(spec);
    expect(prompt).toContain("Set `sourceSpec` to `docs/specs/2609091412-plan-prune.md`");
  });

  it("a plan prompt with a source spec states completesSpec: true (--last) or false (--not-last)", () => {
    expect(planPrompt(true)).toContain("- Set `completesSpec` to `true`.");
    expect(planPrompt(false)).toContain("- Set `completesSpec` to `false`.");
    expect(planPrompt(false)).not.toContain("`completesSpec` to `true`");
  });

  it("a spec prompt asks for an empty arbitratedQuestions, before the schema", () => {
    const prompt = specPrompt();
    const line =
      "- Set `arbitratedQuestions` to `[]`: an authoring session leaves every question open, in `openQuestions`.";
    expect(prompt).toContain(line);
    expect(prompt.indexOf(line)).toBeLessThan(prompt.indexOf('"title": "phax spec document'));
    expect(prompt).not.toContain("preamble.openQuestions");
  });

  it("a plan prompt asks for both preamble question arrays empty, keeping settled arbitrations prose", () => {
    for (const prompt of [planPrompt(true), planPrompt(false)]) {
      expect(prompt).toContain(
        "- Set `preamble.openQuestions` and `preamble.arbitratedQuestions` to `[]`: settled arbitrations stay prose in `preamble.technicalArbitrations`.",
      );
      expect(prompt).not.toContain("an authoring session leaves every question open");
    }
  });

  it("names no decide command", () => {
    for (const prompt of [specPrompt(), planPrompt(true)]) {
      expect(prompt).not.toContain("decide");
    }
  });

  it("a plan prompt without a source spec asks for a null sourceSpec and completesSpec", () => {
    const prompt = buildAuthoringPrompt({
      kind: "plan",
      skillText: "# phax-planning\n",
      jsonSchema: {},
      brief: "brief",
      sourceSpec: null,
      completesSpec: null,
      slug: "catalog-refresh",
    });

    expect(prompt).toContain("Set `sourceSpec` to null");
    expect(prompt).toContain("- Set `completesSpec` to null: this plan has no source spec.");
    expect(prompt).not.toContain("## Source spec");
  });
});
