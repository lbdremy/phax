import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { renderCurrent, type SidecarDocument } from "../../../src/domain/artifact/sidecar.js";
import { describeRevisionRefusal } from "../../../src/domain/decide/revision.js";
import {
  appendedOpenQuestions,
  decodeRevisedAnswer,
  firstQuestionFreezeViolation,
  rendersSameBody,
  restoreLineage,
  reviseCommitMessage,
  revisedByTrailer,
  type RevisionRequester,
} from "../../../src/domain/revise/revision.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import type { OpenQuestion } from "../../../src/schemas/questions.js";
import { PLAN, SPEC, SPEC_KEEP_DECIDED } from "../decide/verdictsFixtures.js";

// The pure core of `phax artifact revise` (spec artifact-revise §5.5–§5.9).
// Every spec, plan and question is made up (tests/unit/decide/verdictsFixtures.ts).

type Json = Record<string, unknown>;

function answerOf(sidecar: SidecarDocument, change: Json = {}): Json {
  const format = sidecar.kind === "spec" ? "spec-document" : "plan-document";
  return {
    ...structuredClone({ $schema: currentSchemaUrl(format), ...sidecar.document }),
    ...change,
  } as Json;
}

function withQuestions(
  sidecar: SidecarDocument,
  change: { open?: unknown[]; arbitrated?: unknown[] },
): SidecarDocument {
  const arrays: Json = {
    ...(change.open === undefined ? {} : { openQuestions: change.open }),
    ...(change.arbitrated === undefined ? {} : { arbitratedQuestions: change.arbitrated }),
  };
  if (sidecar.kind === "spec") {
    return { kind: "spec", document: { ...sidecar.document, ...arrays } as never };
  }
  return {
    kind: "plan",
    document: {
      ...sidecar.document,
      preamble: { ...sidecar.document.preamble, ...arrays },
    } as never,
  };
}

function openOf(sidecar: SidecarDocument): OpenQuestion[] {
  return [
    ...(sidecar.kind === "spec"
      ? sidecar.document.openQuestions
      : sidecar.document.preamble.openQuestions),
  ];
}

function arbitratedOf(sidecar: SidecarDocument): Json[] {
  return [
    ...(sidecar.kind === "spec"
      ? sidecar.document.arbitratedQuestions
      : sidecar.document.preamble.arbitratedQuestions),
  ] as unknown as Json[];
}

function newQuestion(id: string): OpenQuestion {
  return {
    id,
    question: `Does ${id} matter?`,
    options: [
      { id: "yes", label: "Yes", abandons: "speed" },
      { id: "no", label: "No", abandons: "care" },
    ],
    recommendation: "yes",
    rationale: "It does.",
  };
}

// q-scope and q-names open; q-keep arbitrated.
const DECIDED = SPEC_KEEP_DECIDED;
const KEEP_VERDICT = arbitratedOf(DECIDED)[0]?.["verdict"];

function edited(base: SidecarDocument, index: number, change: Json): SidecarDocument {
  return withQuestions(base, {
    open: openOf(base).map((q, i) => (i === index ? { ...q, ...change } : q)),
  });
}

function editedKeep(change: Json): SidecarDocument {
  return withQuestions(DECIDED, {
    arbitrated: arbitratedOf(DECIDED).map((q) => ({ ...q, ...change })),
  });
}

function keepVerdict(change: Json): Json {
  return { verdict: { ...(KEEP_VERDICT as Json), ...change } };
}

interface Edit {
  readonly name: string;
  readonly before: SidecarDocument;
  readonly after: SidecarDocument;
  readonly path: string | undefined;
  readonly message: string | undefined;
}

const EDITS: readonly Edit[] = [
  {
    name: "an open question's recommendation edited (spec)",
    before: SPEC,
    after: edited(SPEC, 1, { recommendation: "per-day" }),
    path: "openQuestions[1].recommendation",
    message: "the writer changed question q-scope",
  },
  {
    name: "an open question's options reordered (plan)",
    before: PLAN,
    after: edited(PLAN, 0, { options: (openOf(PLAN)[0]?.options ?? []).toReversed() }),
    path: "preamble.openQuestions[0].options[0].id",
    message: "the writer changed question Q1",
  },
  {
    name: "an open question's rationale edited (plan)",
    before: PLAN,
    after: edited(PLAN, 1, { rationale: "Different." }),
    path: "preamble.openQuestions[1].rationale",
    message: "the writer changed question Q2",
  },
  {
    name: "an open question removed",
    before: SPEC,
    after: withQuestions(SPEC, { open: openOf(SPEC).slice(0, 2) }),
    path: "openQuestions",
    message: "the writer removed question q-names",
  },
  {
    name: "open questions reordered",
    before: SPEC,
    after: withQuestions(SPEC, { open: openOf(SPEC).toReversed() }),
    path: "openQuestions[0].id",
    message: "the writer moved question q-keep",
  },
  {
    name: "a new question inserted between existing ones",
    before: SPEC,
    after: withQuestions(SPEC, {
      open: [openOf(SPEC)[0], newQuestion("q-new"), ...openOf(SPEC).slice(1)],
    }),
    path: "openQuestions[1].id",
    message: "the writer moved question q-scope",
  },
  {
    name: "an open question moved to arbitratedQuestions",
    before: SPEC,
    after: withQuestions(SPEC, {
      open: openOf(SPEC).slice(1),
      arbitrated: [{ ...openOf(SPEC)[0], verdict: KEEP_VERDICT, history: [] }],
    }),
    path: "arbitratedQuestions[0]",
    message: "new questions are appended to the open questions only",
  },
  {
    name: "an arbitrated question's verdict edited",
    before: DECIDED,
    after: editedKeep(keepVerdict({ why: "Changed my mind." })),
    path: "arbitratedQuestions[0].verdict.why",
    message: "the writer changed question q-keep",
  },
  {
    name: "an arbitrated question's verdict stamp edited",
    before: DECIDED,
    after: editedKeep(keepVerdict({ at: "2030-01-01T00:00:00.000Z" })),
    path: "arbitratedQuestions[0].verdict.at",
    message: "the writer changed question q-keep",
  },
  {
    name: "an arbitrated question's history edited",
    before: DECIDED,
    after: editedKeep({ history: [KEEP_VERDICT] }),
    path: "arbitratedQuestions[0].history[0]",
    message: "the writer changed question q-keep",
  },
  {
    name: "an arbitrated question reopened",
    before: DECIDED,
    after: withQuestions(DECIDED, {
      arbitrated: [],
      open: [...openOf(DECIDED), openOf(SPEC)[0]],
    }),
    path: "arbitratedQuestions",
    message: "the writer removed question q-keep",
  },
  {
    name: "a question appended to arbitratedQuestions",
    before: DECIDED,
    after: withQuestions(DECIDED, {
      arbitrated: [
        ...arbitratedOf(DECIDED),
        { ...newQuestion("q-new"), verdict: KEEP_VERDICT, history: [] },
      ],
    }),
    path: "arbitratedQuestions[1]",
    message: "new questions are appended to the open questions only",
  },
  {
    name: "an appended question reusing an existing id",
    before: DECIDED,
    after: withQuestions(DECIDED, { open: [...openOf(DECIDED), newQuestion("q-keep")] }),
    path: "openQuestions[2].id",
    message: '"q-keep" is already a question of the artifact',
  },
  {
    name: "a clean append (spec)",
    before: SPEC,
    after: withQuestions(SPEC, { open: [...openOf(SPEC), newQuestion("q-new")] }),
    path: undefined,
    message: undefined,
  },
  {
    name: "a clean append (plan)",
    before: PLAN,
    after: withQuestions(PLAN, { open: [...openOf(PLAN), newQuestion("Q3")] }),
    path: undefined,
    message: undefined,
  },
  {
    name: "no change at all",
    before: DECIDED,
    after: structuredClone(DECIDED),
    path: undefined,
    message: undefined,
  },
];

describe("firstQuestionFreezeViolation", () => {
  it.each(EDITS)("$name", ({ before, after, path, message }) => {
    const violation = firstQuestionFreezeViolation(before, after);
    if (path === undefined || message === undefined) {
      expect(violation).toBeUndefined();
      return;
    }
    expect(violation?.path).toBe(path);
    expect(violation?.message).toContain(message);
  });

  it("refuses a change of kind", () => {
    expect(firstQuestionFreezeViolation(SPEC, PLAN)?.path).toBe("kind");
  });

  it("treats key order as no change", () => {
    const reordered = withQuestions(SPEC, {
      open: openOf(SPEC).map((q) => Object.fromEntries(Object.entries(q).toReversed())),
    });
    expect(firstQuestionFreezeViolation(SPEC, reordered)).toBeUndefined();
  });
});

describe("appendedOpenQuestions", () => {
  it("lists the open questions after the original's, in order", () => {
    const after = withQuestions(SPEC, {
      open: [...openOf(SPEC), newQuestion("q-a"), newQuestion("q-b")],
    });
    expect(appendedOpenQuestions(SPEC, after)).toEqual([
      { id: "q-a", question: "Does q-a matter?" },
      { id: "q-b", question: "Does q-b matter?" },
    ]);
    expect(appendedOpenQuestions(SPEC, SPEC)).toEqual([]);
  });
});

describe("restoreLineage", () => {
  it("sets a plan's sourceSpec and completesSpec from the original, without mutating", () => {
    if (PLAN.kind !== "plan") throw new Error("fixture");
    const json = answerOf(PLAN, { sourceSpec: "docs/specs/other.md", completesSpec: false });
    const restored = restoreLineage(json, PLAN) as Json;
    expect(restored["sourceSpec"]).toBe(PLAN.document.sourceSpec);
    expect(restored["completesSpec"]).toBe(PLAN.document.completesSpec);
    expect(json["sourceSpec"]).toBe("docs/specs/other.md");
  });

  it("returns a spec answer and a non-object as they are", () => {
    const json = answerOf(SPEC);
    expect(restoreLineage(json, SPEC)).toBe(json);
    expect(restoreLineage("prose", PLAN)).toBe("prose");
  });
});

describe("decodeRevisedAnswer", () => {
  function refused(json: unknown, original: SidecarDocument): string {
    const decoded = decodeRevisedAnswer(json, original);
    if (Result.isSuccess(decoded)) throw new Error("expected a refusal");
    return describeRevisionRefusal(decoded.failure);
  }

  it("refuses prose at the root", () => {
    expect(refused("Here is the document.", SPEC)).toContain("not a JSON object");
  });

  it("refuses a missing and a wrong $schema at $schema", () => {
    const { $schema: _drop, ...bare } = answerOf(SPEC);
    expect(refused(bare, SPEC)).toContain("$schema: the answer carries no $schema");
    expect(refused(answerOf(PLAN), SPEC)).toContain("$schema: ");
    expect(refused(answerOf(PLAN), SPEC)).toContain("plan-document");
  });

  it("refuses a decode failure", () => {
    expect(refused(answerOf(SPEC, { title: 12 }), SPEC)).toContain("title");
  });

  it("refuses a changed question after a good decode", () => {
    const json = answerOf(SPEC, { openQuestions: openOf(SPEC).slice(1) });
    expect(refused(json, SPEC)).toContain("the writer");
  });

  it("restores a plan's lineage before decoding and returns the appended questions", () => {
    if (PLAN.kind !== "plan") throw new Error("fixture");
    const json = answerOf(PLAN, {
      sourceSpec: "docs/specs/other.md",
      completesSpec: false,
      preamble: {
        ...(answerOf(PLAN)["preamble"] as Json),
        openQuestions: [...openOf(PLAN), newQuestion("Q3")],
      },
    });
    const decoded = decodeRevisedAnswer(json, PLAN);
    if (Result.isFailure(decoded)) throw new Error(describeRevisionRefusal(decoded.failure));
    const { document, newQuestions } = decoded.success;
    if (document.kind !== "plan") throw new Error("expected a plan");
    expect(document.document.sourceSpec).toBe(PLAN.document.sourceSpec);
    expect(document.document.completesSpec).toBe(PLAN.document.completesSpec);
    expect(newQuestions).toEqual([{ id: "Q3", question: "Does Q3 matter?" }]);
  });

  it("accepts the original document unchanged", () => {
    expect(Result.isSuccess(decodeRevisedAnswer(answerOf(SPEC), SPEC))).toBe(true);
  });
});

describe("rendersSameBody", () => {
  it("is true for the document's own rendering and false after a body edit", () => {
    if (SPEC.kind !== "spec") throw new Error("fixture");
    const md = `---\nstatus: Draft\n---\n${renderCurrent(SPEC)}`;
    expect(rendersSameBody(md, SPEC)).toBe(true);
    const edit: SidecarDocument = {
      kind: "spec",
      document: { ...SPEC.document, problem: "A different problem entirely." },
    };
    expect(rendersSameBody(md, edit)).toBe(false);
  });
});

describe("reviseCommitMessage", () => {
  const amendment =
    "The identity crate must compile, pass clippy and pass its tests, offline,\non a migrated SQLite, at every phase that touches its code.";
  const base = {
    kind: "plan",
    slug: "identity-store",
    path: "docs/plans/2610271402-identity-store-plan.md",
    amendment,
    model: "claude-sonnet-5-5",
    effort: "medium",
    provider: "claude-code",
    revisionId: "2610271402-identity-store/01",
  } as const;

  it("matches the spec's example for a machine requester", () => {
    const { subject, body } = reviseCommitMessage({
      ...base,
      requester: { kind: "machine", grant: "plan-loop" },
    });
    expect(subject).toBe("docs(plans): revise identity-store");
    expect(body).toBe(
      [
        "Revised headless (claude-sonnet-5-5 / medium, claude-code) from this amendment:",
        "",
        "The identity crate must compile, pass clippy and pass its tests, offline,",
        "on a migrated SQLite, at every phase that touches its code.",
        "",
        "Artifact: docs/plans/2610271402-identity-store-plan.md",
        "Revised-By: machine (plan-loop)",
        "Revision-Id: 2610271402-identity-store/01",
      ].join("\n"),
    );
  });

  it("names an operator and strips only the amendment's trailing whitespace", () => {
    const { subject, body } = reviseCommitMessage({
      ...base,
      kind: "spec",
      amendment: "  Keep this.\n\n  And this.   \n\n",
      requester: { kind: "operator", name: "Ada Lovelace" },
    });
    expect(subject).toBe("docs(specs): revise identity-store");
    expect(body).toContain("amendment:\n\n  Keep this.\n\n  And this.\n\nArtifact: ");
    expect(body).toContain("Revised-By: operator (Ada Lovelace)\nRevision-Id");
  });
});

describe("revisedByTrailer", () => {
  it("names the operator by name and a machine by its grant", () => {
    const operator: RevisionRequester = { kind: "operator", name: "Ada Lovelace" };
    const machine: RevisionRequester = { kind: "machine", grant: "plan-loop" };
    expect(revisedByTrailer(operator)).toBe("operator (Ada Lovelace)");
    expect(revisedByTrailer(machine)).toBe("machine (plan-loop)");
  });
});
