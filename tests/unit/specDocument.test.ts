// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { describe, expect, it } from "vitest";
import { Either } from "effect";
import {
  decodeSpecDocument,
  getSpecDocumentJsonSchema,
  type SpecDocument,
} from "../../src/schemas/specDocument.js";
import { formatFirstViolation } from "../../src/schemas/formatError.js";

function validSpecDocument() {
  return {
    version: 1,
    kind: "spec",
    title: "Plan Prune",
    ground: [{ path: "docs/ideas/plan-prune.md", note: "the idea this spec makes precise" }],
    context: "A slug is held forever by its archived run.",
    problem: "The `-2` habit is the visible symptom.",
    productGoal: {
      statement: "Free a slug once its run is archived.",
      guidingRule: "A slug is held only by a live run.",
    },
    terminology: [{ term: "live run", definition: "a run that is not archived" }],
    requirements: [
      {
        id: "5.1",
        title: "Prune eligibility",
        pattern: "event",
        statement: "WHEN a run is archived THE system SHALL make it eligible to prune.",
      },
      {
        id: "5.2",
        title: "Prune refusal",
        pattern: "unwanted",
        statement: "IF the run is live THEN the system SHALL refuse to prune it.",
      },
    ],
    surface: [
      {
        surface: "cli: `phax prune <run>`",
        binding: "normative",
        before: null,
        after: "phax prune usage-cli\n  pruned usage-cli\n  $? = 0",
      },
      {
        surface: "config: `phax.json` `archive.prune`",
        binding: "indicative",
        before: '"archive": { "keep": 10 }',
        after: '"archive": { "keep": 10, "prune": "manual" }',
      },
    ],
    nonGoals: ["pruning a run that is not archived"],
    acceptanceCriteria: [
      {
        id: "AC-1",
        name: "Prune frees the slug",
        given: "an archived run usage-cli",
        when: "`phax prune usage-cli` runs",
        then: "the slug is free",
        refs: ["5.1"],
      },
      {
        id: "AC-2",
        name: "Live runs are kept",
        given: "a live run usage-cli",
        when: "`phax prune usage-cli` runs",
        then: "it refuses",
        refs: ["5.2", "5.1"],
      },
    ],
    openQuestions: [
      {
        id: "Q1",
        question: "Is pruning manual or automatic past `keep`?",
        options: [
          { id: "manual", label: "an explicit `phax prune`", abandons: "self-shrinking" },
          { id: "auto", label: "prune at archive time", abandons: "later inspection" },
        ],
        recommendation: "manual",
        rationale: "records already keep the trajectory",
      },
    ],
    planningNote: { settled: ["manual prune"], open: [], constraints: ["no new state"] },
    docsPage: {
      kind: "page",
      page: "docs/cli/prune.md",
      reader: "an operator whose `-2` runs pile up",
      example: "phax prune usage-cli",
    },
  };
}

type Mutable = ReturnType<typeof validSpecDocument> & Record<string, unknown>;

function rejection(doc: unknown): string {
  const result = decodeSpecDocument(doc);
  if (Either.isRight(result)) throw new Error("expected the document to be rejected");
  return formatFirstViolation(result.left);
}

describe("decodeSpecDocument", () => {
  it("decodes a full valid spec document", () => {
    const result = decodeSpecDocument(validSpecDocument());
    expect(Either.isRight(result)).toBe(true);
    const doc = Either.getOrThrow(result) satisfies SpecDocument;
    expect(doc.requirements.map((r) => r.id)).toEqual(["5.1", "5.2"]);
    expect(doc.docsPage.kind).toBe("page");
  });

  it("accepts the `none` docs-page variant", () => {
    const doc: Mutable = validSpecDocument();
    doc.docsPage = { kind: "none", why: "an internal change with no reader" } as never;
    expect(Either.isRight(decodeSpecDocument(doc))).toBe(true);
  });

  it("rejects a criterion ref naming no requirement, naming the path", () => {
    const doc = validSpecDocument();
    doc.acceptanceCriteria.push({
      id: "AC-3",
      name: "Dangling",
      given: "g",
      when: "w",
      then: "t",
      refs: ["5.9"],
    });
    expect(rejection(doc)).toBe('acceptanceCriteria[2].refs[0]: "5.9" names no requirement');
  });

  it("rejects a requirement no criterion covers", () => {
    const doc = validSpecDocument();
    doc.acceptanceCriteria[1]!.refs = ["5.1"];
    expect(rejection(doc)).toBe(
      'requirements[1].id: "5.2" is referenced by no acceptance criterion',
    );
  });

  it("rejects a question with a single option", () => {
    const doc = validSpecDocument();
    doc.openQuestions[0]!.options = [doc.openQuestions[0]!.options[0]!];
    expect(rejection(doc)).toMatch(/^openQuestions\[0\]\.options: .*at least 2/);
  });

  it("rejects a recommendation that names none of the options", () => {
    const doc = validSpecDocument();
    doc.openQuestions[0]!.recommendation = "hybrid";
    expect(rejection(doc)).toBe(
      'openQuestions[0].recommendation: "hybrid" names none of the question\'s options (manual, auto)',
    );
  });

  it("rejects duplicate requirement ids", () => {
    const doc = validSpecDocument();
    doc.requirements[1]!.id = "5.1";
    expect(rejection(doc)).toBe(
      'requirements[1].id: "5.1" duplicates the requirement id at index 0',
    );
  });

  it("rejects duplicate question ids", () => {
    const doc = validSpecDocument();
    doc.openQuestions.push({ ...doc.openQuestions[0]! });
    expect(rejection(doc)).toBe('openQuestions[1].id: "Q1" duplicates the question id at index 0');
  });

  it("rejects duplicate option ids within a question", () => {
    const doc = validSpecDocument();
    doc.openQuestions[0]!.options[1]!.id = "manual";
    expect(rejection(doc)).toBe(
      'openQuestions[0].options[1].id: "manual" duplicates the option id at index 0',
    );
  });

  it("rejects an unknown top-level key", () => {
    const doc: Mutable = validSpecDocument();
    doc.summary = "not a spec field";
    expect(rejection(doc)).toMatch(/^summary: is unexpected/);
  });

  it("rejects a surface off the roadmap form and an unknown EARS pattern", () => {
    const offForm = validSpecDocument();
    offForm.surface[0]!.surface = "command: phax prune";
    expect(rejection(offForm)).toMatch(/^surface\[0\]\.surface: /);

    const badPattern = validSpecDocument();
    badPattern.requirements[0]!.pattern = "complex";
    expect(rejection(badPattern)).toMatch(/^requirements\[0\]\.pattern: /);
  });

  it("rejects a missing key rather than defaulting it", () => {
    const { nonGoals: _dropped, ...doc } = validSpecDocument();
    expect(rejection(doc)).toMatch(/^nonGoals: is missing/);
  });
});

describe("getSpecDocumentJsonSchema", () => {
  it("is titled experimental and closed to extra keys", () => {
    const schema = getSpecDocumentJsonSchema() as {
      title: string;
      additionalProperties: boolean;
      required: string[];
    };
    expect(schema.title).toBe("phax spec document (experimental)");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("acceptanceCriteria");
    expect(schema.required).toContain("docsPage");
  });
});
