import { describe, expect, it } from "vitest";
import {
  AUTHORING_PROMPT_FILENAME,
  buildAuthoringPrompt,
} from "../../src/domain/authoring/prompt.js";
import type { SpecCriteria } from "../../src/domain/plan/criterionCoverage.js";

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
    architectureProvider: null,
    assignmentBounds: null,
    oraclesProvider: null,
  });
}

const SPEC_PATH = "docs/specs/2609091412-plan-prune.md";
const CRITERIA: SpecCriteria = {
  kind: "criteria",
  spec: SPEC_PATH,
  slug: "plan-prune",
  criteria: [
    { id: "ac-prune", name: "Pruning frees the slug" },
    { id: "ac-keep", name: "A live run is kept" },
  ],
};

function planPrompt(
  completesSpec: boolean,
  architectureProvider = false,
  assignmentBounds = false,
  oraclesProvider = false,
  criteria: SpecCriteria = CRITERIA,
): string {
  return buildAuthoringPrompt({
    kind: "plan",
    skillText: "# phax-planning\n",
    jsonSchema: { title: "phax plan document (experimental)" },
    brief: "BRIEF-MARKER",
    sourceSpec: {
      path: SPEC_PATH,
      markdown: "---\nstatus: Approved\n---\n# SPEC-BODY-MARKER\n",
      criteria,
    },
    completesSpec,
    slug: "plan-prune",
    architectureProvider,
    assignmentBounds,
    oraclesProvider,
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

  it("a plan prompt invites open questions in the spec's shape, keeps settled arbitrations prose and arbitrates none, before the schema", () => {
    for (const prompt of [planPrompt(true), planPrompt(false)]) {
      const invite =
        "- Leave each technical arbitration you cannot settle as an open question in `preamble.openQuestions`, in the same shape as a spec's: `id`, `question`, `options` (each with `id`, `label` and `abandons`), `recommendation` naming one option id, and `rationale`. The operator answers them before the plan is approved.";
      expect(prompt).toContain(invite);
      expect(prompt).toContain(
        "- Settled arbitrations stay prose in `preamble.technicalArbitrations`.",
      );
      expect(prompt).toContain(
        "- Set `preamble.arbitratedQuestions` to `[]`: an authoring session arbitrates no question.",
      );
      expect(prompt).not.toContain("Set `preamble.openQuestions`");
      expect(prompt).not.toContain("an authoring session leaves every question open");
      expect(prompt.indexOf(invite)).toBeLessThan(prompt.indexOf('"title": "phax plan document'));
    }
  });

  it("a plan prompt states whether an oracles provider is configured, a spec prompt neither", () => {
    expect(planPrompt(true, false, false, true)).toContain(
      '- An oracles provider is configured ("oracles" in phax config): you may declare an oracle phase',
    );
    expect(planPrompt(true, false, false, false)).toContain(
      "- No oracles provider is configured: declare no oracle phase; every phase's `oracle` is null.",
    );
    expect(specPrompt()).not.toContain("oracles provider");
  });

  it("places the oracles bullet right after the architecture bullet", () => {
    const lines = planPrompt(true, false, false, true).split("\n");
    const architecture = lines.findIndex((l) => l.includes("No architecture provider"));
    expect(lines[architecture + 1]).toContain("An oracles provider is configured");
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
      architectureProvider: false,
      assignmentBounds: false,
      oraclesProvider: false,
    });

    expect(prompt).toContain("Set `sourceSpec` to null");
    expect(prompt).toContain("- Set `completesSpec` to null: this plan has no source spec.");
    expect(prompt).toContain(
      "- Set every test line's `criterion` to null: this plan has no source spec.",
    );
    expect(prompt).not.toContain("## Source spec");
  });

  it("a plan prompt lists the source spec's criterion ids and names after the spec, before the brief", () => {
    const prompt = planPrompt(true);
    const heading = prompt.indexOf(
      `## Source spec acceptance criteria (${SPEC_PATH}, ids from its JSON sidecar)`,
    );

    expect(heading).toBeGreaterThan(prompt.indexOf("SPEC-BODY-MARKER"));
    expect(prompt.indexOf("BRIEF-MARKER")).toBeGreaterThan(heading);
    expect(prompt.slice(heading)).toContain(
      "\n\n- `ac-prune` — Pruning frees the slug\n- `ac-keep` — A live run is kept\n",
    );
  });

  it("a plan prompt asks for the id on each line that proves a criterion, in the output contract", () => {
    const prompt = planPrompt(true);
    const line =
      "- On each test line that proves one of the source spec's acceptance criteria, set `criterion` to that criterion's id, from the list under \"Source spec acceptance criteria\" below; a line that proves none has `criterion` null.";

    expect(prompt).toContain(line);
    expect(prompt.indexOf(line)).toBeLessThan(prompt.indexOf('"title": "phax plan document'));
  });

  it("a plan prompt whose source spec has no sidecar says so and lists no criterion", () => {
    const prompt = planPrompt(true, false, false, false, {
      kind: "no-criterion-ids",
      spec: SPEC_PATH,
      reason: "no-sidecar",
      message: `source spec ${SPEC_PATH} has no JSON sidecar: no criterion id is checked`,
    });

    expect(prompt).toContain(
      "- The source spec has no JSON sidecar, so its acceptance criteria carry no id: set every test line's `criterion` to null.",
    );
    expect(prompt).not.toContain("## Source spec acceptance criteria");
    expect(prompt).not.toContain("On each test line that proves");
  });

  it("a plan prompt whose source spec's sidecar cannot be read names why", () => {
    const message =
      "source spec sidecar docs/specs/x.json cannot be read (bad JSON): no criterion id is checked";
    const prompt = planPrompt(true, false, false, false, {
      kind: "no-criterion-ids",
      spec: SPEC_PATH,
      reason: "unreadable",
      message,
    });

    expect(prompt).toContain(
      `- The source spec's criterion ids cannot be read (${message}): set every test line's \`criterion\` to null.`,
    );
    expect(prompt).not.toContain("## Source spec acceptance criteria");
  });

  it("a plan prompt with a provider tells the planner to run phax architecture, before the output contract", () => {
    const prompt = planPrompt(true, true);
    const line = prompt.indexOf(
      "- An architecture provider is configured: before cutting phases and assigning models, run `phax architecture` (or `phax architecture <path>...` for the parts the plan touches) and plan against its answer.",
    );

    expect(line).toBeGreaterThan(prompt.indexOf("You are authoring the plan"));
    expect(line).toBeLessThan(prompt.indexOf("- Return ONLY"));
    expect(prompt).not.toContain("No architecture provider is configured");
  });

  it("a plan prompt without a provider says so and does not ask to run the command", () => {
    const prompt = planPrompt(true, false);

    expect(prompt).toContain(
      "- No architecture provider is configured: do not run `phax architecture`; read the architecture from the code and its documentation (README, CLAUDE.md or equivalent).",
    );
    expect(prompt).not.toContain("An architecture provider is configured");
    expect(prompt.indexOf("No architecture provider")).toBeLessThan(
      prompt.indexOf("- Return ONLY"),
    );
  });

  it("a plan prompt with a provider and bounds adds the sentence about the bounds", () => {
    const prompt = planPrompt(true, true, true);

    expect(prompt).toContain(
      "and plan against its answer. It lists the assignment bounds (phax.json `assignments`) after the parts: assign each phase against them.\n",
    );
    expect(prompt).not.toContain("No architecture provider is configured");
  });

  it("a plan prompt with bounds and no provider sends the planner to the command", () => {
    const prompt = planPrompt(true, false, true);
    const line = prompt.indexOf("- Assignment bounds are declared (phax.json `assignments`)");

    expect(prompt).toContain(
      "- Assignment bounds are declared (phax.json `assignments`), and no architecture provider is configured: before cutting phases and assigning models, run `phax architecture`. It exits 1 with its no-provider line, then lists the bounds; read the architecture from the code and its documentation (README, CLAUDE.md or equivalent).",
    );
    expect(line).toBeLessThan(prompt.indexOf("- Return ONLY"));
    expect(prompt).not.toContain("do not run `phax architecture`");
  });

  it("lists no bound in any plan prompt", () => {
    for (const prompt of [planPrompt(true, true, true), planPrompt(true, false, true)]) {
      expect(prompt).not.toContain("assignments[");
      expect(prompt).not.toContain("globs `");
    }
  });

  it("a spec prompt carries no architecture statement", () => {
    expect(specPrompt()).not.toMatch(/architecture provider|phax architecture/);
  });

  it("states in both kinds' output contract that other is reserved", () => {
    const sentence =
      "`other` is a reserved id, implicit on every question: never list an option with the id `other`, and never recommend it.";
    for (const prompt of [specPrompt(), planPrompt(true)]) {
      const at = prompt.indexOf(sentence);
      expect(at).toBeGreaterThan(prompt.indexOf("Return ONLY a JSON object"));
      expect(at).toBeLessThan(prompt.search(/^## .* JSON Schema$/m));
    }
  });
});
