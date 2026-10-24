// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { describe, expect, it } from "vitest";
import { Either } from "effect";
import {
  decodeSpecDocument,
  decodeSpecDocumentFile,
  getSpecDocumentJsonSchema,
  SURFACE_SUMMARY_PLACEHOLDER,
  type SpecDocument,
} from "../../src/schemas/specDocument.js";
import { formatFirstViolation } from "../../src/schemas/formatError.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";

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
        summary: "An operator can free an archived run's slug with one command.",
        binding: "normative",
        before: null,
        after: "phax prune usage-cli\n  pruned usage-cli\n  $? = 0",
      },
      {
        surface: "config: `phax.json` `archive.prune`",
        summary: "A maintainer can choose whether archived runs are pruned by hand.",
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
    arbitratedQuestions: [],
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

// The valid document with its first surface element's summary replaced.
function withSummary(summary: string) {
  const doc = validSpecDocument();
  return { ...doc, surface: [{ ...doc.surface[0]!, summary }, ...doc.surface.slice(1)] };
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
    expect(rejection(doc)).toBe(
      'openQuestions[1].id: "Q1" duplicates the question id at openQuestions[0]',
    );
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
    doc["summary"] = "not a spec field";
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

  it("rejects a missing arbitratedQuestions", () => {
    const { arbitratedQuestions: _dropped, ...doc } = validSpecDocument();
    expect(rejection(doc)).toBe("arbitratedQuestions: is missing");
  });

  // ac-internal-too: the summary is required on every kind of element.
  it("rejects an internal element without a summary, naming surface[0].summary", () => {
    const { summary: _dropped, ...element } = validSpecDocument().surface[0]!;
    const doc = {
      ...validSpecDocument(),
      surface: [
        { ...element, surface: "internal: phax-plan.json reconciliation", binding: "indicative" },
      ],
    };
    expect(rejection(doc)).toMatch(/^surface\[0\]\.summary: is missing/);
  });

  // ac-empty
  it("rejects an empty summary, naming surface[0].summary", () => {
    const doc = withSummary("");
    expect(rejection(doc)).toMatch(/^surface\[0\]\.summary: /);
  });

  // ac-line-break
  it.each([
    ["a line feed", "It frees the slug.\nIt also prunes."],
    ["a carriage return", "It frees the slug.\rIt also prunes."],
    ["a CRLF", "It frees the slug.\r\nIt also prunes."],
    ["a next line", "It frees the slug.\u0085It also prunes."],
    ["a line separator", "It frees the slug.\u2028It also prunes."],
    ["a paragraph separator", "It frees the slug.\u2029It also prunes."],
  ])("rejects a summary holding %s, naming surface[0].summary", (_name, summary) => {
    expect(rejection(withSummary(summary))).toMatch(/^surface\[0\]\.summary: /);
  });

  it("decodes a long one-line summary", () => {
    const summary = `An operator can ${"free the slug of an archived run and ".repeat(40)}done.`;
    expect(Either.isRight(decodeSpecDocument(withSummary(summary)))).toBe(true);
  });

  it("accepts the summary placeholder", () => {
    expect(Either.isRight(decodeSpecDocument(withSummary(SURFACE_SUMMARY_PLACEHOLDER)))).toBe(true);
  });

  it("rejects an authoring answer carrying an arbitrated question, at its first entry (§5.60)", () => {
    const doc = { ...validSpecDocument(), arbitratedQuestions: [liftedQuestion()] };
    expect(rejection(doc)).toBe(
      "arbitratedQuestions[0]: an authoring session returns open questions only: arbitratedQuestions must be []",
    );
  });
});

// A sidecar of the made-up spec `plan-prune`, at the current shape.
function sidecar(arbitratedQuestions: ReadonlyArray<unknown>) {
  const { version: _version, ...doc } = validSpecDocument();
  return { $schema: currentSchemaUrl("spec-document"), ...doc, arbitratedQuestions };
}

function liftedQuestion() {
  return {
    id: "q-keep",
    question: "How many archived runs are kept?",
    options: [
      { id: "keep-10", label: "ten", abandons: "older trajectories" },
      { id: "keep-20", label: "twenty", abandons: "a small archive" },
    ],
    recommendation: "keep-10",
    rationale: "Decided by the author on 2026-09-28, as recommended.",
    verdict: {
      kind: "lifted",
      chosen: "keep-10",
      abandoned: ["keep-20"],
      why: "Decided by the author on 2026-09-28, as recommended.",
      at: "2026-09-28",
      by: { kind: "unattributed" },
    } as Record<string, unknown>,
    history: [] as unknown[],
  };
}

function decidedVerdict() {
  return {
    kind: "decided",
    chosen: "keep-20",
    abandoned: ["keep-10"],
    why: "twenty covers a release cycle",
    advocate: "ten keeps the archive small",
    principles: ["S2"],
    reversibility: "cheap",
    by: { kind: "operator", name: "Ada Lovelace" } as Record<string, unknown>,
    at: "2026-10-20T08:02:11Z",
    revised: ["§5.4"],
  };
}

function fileRejection(doc: unknown): string {
  const result = decodeSpecDocumentFile(doc);
  if (Either.isRight(result)) throw new Error("expected the sidecar to be rejected");
  return formatFirstViolation(result.left);
}

describe("decodeSpecDocumentFile", () => {
  it("accepts lifted and decided verdicts, with a history", () => {
    const decided = { ...liftedQuestion(), id: "q-scope", verdict: decidedVerdict() };
    const rearbitrated = {
      ...liftedQuestion(),
      id: "q-again",
      verdict: decidedVerdict(),
      history: [liftedQuestion().verdict],
    };
    expect(
      Either.isRight(decodeSpecDocumentFile(sidecar([liftedQuestion(), decided, rearbitrated]))),
    ).toBe(true);
  });

  it("rejects a lifted verdict carrying a decided verdict's key", () => {
    const question = liftedQuestion();
    question.verdict["advocate"] = "ten keeps the archive small";
    expect(fileRejection(sidecar([question]))).toMatch(/^arbitratedQuestions\[0\]\.verdict/);
  });

  it("rejects a decided verdict that names no operator", () => {
    const verdict = { ...decidedVerdict(), by: { kind: "unattributed" } };
    expect(fileRejection(sidecar([{ ...liftedQuestion(), verdict }]))).toMatch(
      /^arbitratedQuestions\[0\]\.verdict/,
    );
  });

  it("rejects a missing arbitratedQuestions", () => {
    const { arbitratedQuestions: _dropped, ...doc } = sidecar([]);
    expect(fileRejection(doc)).toBe("arbitratedQuestions: is missing");
  });

  it("runs the question checks, at document-relative paths", () => {
    const question = liftedQuestion();
    question.verdict["abandoned"] = [];
    expect(fileRejection(sidecar([question]))).toBe(
      'arbitratedQuestions[0].verdict.abandoned: misses "keep-20": a verdict abandons every option it does not choose',
    );
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

  it("declares the traceability checks it cannot express in its root description", () => {
    const schema = getSpecDocumentJsonSchema() as { description: string };
    expect(schema.description).toMatch(/^Checked by phax's parser, not by this JSON Schema: /);
    for (const check of [
      "unique",
      "`refs` entry",
      "referenced by",
      "`recommendation`",
      "`chosen`",
      "`abandoned`",
    ]) {
      expect(schema.description).toContain(check);
    }
  });

  // ac-schema
  it("lists summary as a required one-line string right after surface, inline", () => {
    const schema = getSpecDocumentJsonSchema() as {
      properties: { surface: { items: Record<string, unknown> } };
    };
    const item = schema.properties.surface.items as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, Record<string, unknown>>;
    };
    expect(item.additionalProperties).toBe(false);
    expect(item.required.slice(0, 2)).toEqual(["surface", "summary"]);
    expect(Object.keys(item.properties).slice(0, 2)).toEqual(["surface", "summary"]);
    expect(item.properties["summary"]).toEqual({
      type: "string",
      description:
        "One sentence, in the consumer's words: what whoever consumes this element can now do or sees differently. Never where it lives or how it is built.",
      pattern: "^[^\\n\\r\\u0085\\u2028\\u2029]+$",
    });
  });

  it("says an authoring answer's arbitratedQuestions is empty", () => {
    const schema = getSpecDocumentJsonSchema() as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toContain("arbitratedQuestions");
    expect(schema.properties["arbitratedQuestions"]).toMatchObject({ type: "array", maxItems: 0 });
  });
});
