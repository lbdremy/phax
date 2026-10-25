import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { serializeSidecar, type SidecarDocument } from "../../../src/domain/artifact/sidecar.js";
import { renderPlanBody } from "../../../src/domain/authoring/renderPlan.js";
import { renderSpecBody } from "../../../src/domain/authoring/renderSpec.js";
import {
  type DecideContext,
  type DecideScope,
  answerStampViolation,
  decidedInSession,
  decideScope,
  decodeRevisedDocument,
  describeRevisionRefusal,
  firstRevisionViolation,
  questionsOf,
  renderRevisedArtifact,
  stampSessionVerdicts,
} from "../../../src/domain/decide/revision.js";
import type { PlanDocument } from "../../../src/schemas/planDocument.js";
import type {
  OpenQuestion,
  PlanArbitratedQuestion,
  SpecArbitratedQuestion,
  SpecVerdict,
} from "../../../src/schemas/questions.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import type { SpecDocument } from "../../../src/schemas/specDocument.js";

// The pure core of `phax artifact decide` on headless-authored artifacts
// (spec artifact-decide §5.18–§5.21, §5.26, §5.32–§5.34). Every spec, plan,
// question and operator here is made up.

const AT = "2026-10-20T08:02:11.000Z";
const OPERATOR = { name: "Ada Lovelace" };
const PRINCIPLES: ReadonlySet<string> = new Set(["E0", "C1", "S1", "S2", "X1"]);

function question(id: string, recommendation = `${id}-a`): OpenQuestion {
  return {
    id,
    question: `What about ${id}?`,
    options: [
      { id: `${id}-a`, label: "First", abandons: "the second" },
      { id: `${id}-b`, label: "Second", abandons: "the first" },
    ],
    recommendation,
    rationale: `${id}-a is cheaper`,
  };
}

function decided(q: OpenQuestion, chosen: string, extra: Partial<SpecVerdict> = {}): SpecVerdict {
  return {
    kind: "decided",
    chosen,
    abandoned: q.options.map((o) => o.id).filter((id) => id !== chosen),
    why: "the operator said so",
    advocate: "the other option is simpler",
    principles: ["S1"],
    reversibility: "cheap",
    by: { kind: "operator", name: "Grace Hopper" },
    at: "2026-10-01T10:00:00Z",
    revised: chosen === q.recommendation ? [] : ["§5.1"],
    ...extra,
  } as SpecVerdict;
}

function arbitrated(q: OpenQuestion, verdict: SpecVerdict): SpecArbitratedQuestion {
  return { ...q, verdict, history: [] };
}

const Q0 = question("Q0");
const Q1 = question("Q1");
const Q2 = question("Q2");

function specDocument(overrides: Partial<SpecDocument> = {}): SpecDocument {
  return {
    kind: "spec",
    title: "Log rotation",
    ground: [{ path: "src/app/logs.ts", note: "where logs are written" }],
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
    openQuestions: [Q1, Q2],
    arbitratedQuestions: [arbitrated(Q0, decided(Q0, "Q0-a"))],
    planningNote: { settled: [], open: [], constraints: [] },
    docsPage: { kind: "none", why: "the CLI reference covers it" },
    ...overrides,
  };
}

function spec(overrides: Partial<SpecDocument> = {}): SidecarDocument {
  return { kind: "spec", document: specDocument(overrides) };
}

function phase(id: string) {
  return {
    id,
    title: `Step ${id}`,
    planMarkdownAnchor: `#${id}-step`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode: "headless",
    oracle: null,
    commit: { subject: `feat: ${id}`, body: "Do the step." },
    objective: "Do the step.",
    detailedInstructions: [],
    boundaryContracts: null,
    testStrategy: [],
    implementationOrder: [],
    excludedScope: [],
    verification: "standard",
    expectedHandoff: "Nothing.",
    assignmentReason: null,
    model: "claude-sonnet-5",
    effort: "medium",
  };
}

function planDocument(preamble: Partial<PlanDocument["preamble"]> = {}): PlanDocument {
  return {
    kind: "plan",
    sourceSpec: "docs/specs/2609281200-log-rotation.md",
    completesSpec: true,
    run: { shortName: "log-rotation", title: "Log rotation", requiredCommands: [] },
    preamble: {
      summary: "Two phases: the store, then the command.",
      requiredCommandsNote: "No extra commands.",
      technicalArbitrations: [],
      openQuestions: [Q1],
      arbitratedQuestions: [],
      ...preamble,
    },
    phases: [phase("phase-01"), phase("phase-02")],
  } as PlanDocument;
}

function plan(preamble: Partial<PlanDocument["preamble"]> = {}): SidecarDocument {
  return { kind: "plan", document: planDocument(preamble) };
}

// The JSON a session returns for a document: its sidecar form, `$schema`
// first. Not encoded, so an invalid document stays expressible.
function answer(sidecar: SidecarDocument): Record<string, unknown> {
  const format = sidecar.kind === "spec" ? "spec-document" : "plan-document";
  return structuredClone({
    $schema: schemaUrl(format, CURRENT_STAMPS[format]),
    ...sidecar.document,
  }) as Record<string, unknown>;
}

const ALL_OPEN: DecideScope = { presented: ["Q1", "Q2"], reArbitrated: null };

function context(original: SidecarDocument, scope: DecideScope = ALL_OPEN): DecideContext {
  return { original, scope, operator: OPERATOR, atIso: AT };
}

function decode(json: unknown, ctx: DecideContext): SidecarDocument {
  const decoded = decodeRevisedDocument(json, ctx);
  if (Either.isLeft(decoded)) throw new Error(describeRevisionRefusal(decoded.left));
  return decoded.right;
}

function refusalOf(json: unknown, ctx: DecideContext): string {
  const decoded = decodeRevisedDocument(json, ctx);
  if (Either.isRight(decoded)) throw new Error("expected a refusal");
  return describeRevisionRefusal(decoded.left);
}

// Q1 decided (as recommended) in a session on `spec()`.
function specWithQ1Decided(verdict: SpecVerdict = decided(Q1, "Q1-a")): SidecarDocument {
  return spec({
    openQuestions: [Q2],
    arbitratedQuestions: [arbitrated(Q0, decided(Q0, "Q0-a")), arbitrated(Q1, verdict)],
  });
}

function violation(after: SidecarDocument, scope: DecideScope = ALL_OPEN, before = spec()) {
  const found = firstRevisionViolation({ before, after, scope, principleIds: PRINCIPLES });
  return found === undefined ? undefined : describeRevisionRefusal(found);
}

describe("decideScope", () => {
  const questions = questionsOf(spec());

  it("presents every open question without --question", () => {
    expect(decideScope(questions, null)).toEqual(
      Either.right({ presented: ["Q1", "Q2"], reArbitrated: null }),
    );
  });

  it("presents an open question alone", () => {
    expect(decideScope(questions, "Q2")).toEqual(
      Either.right({ presented: ["Q2"], reArbitrated: null }),
    );
  });

  it("presents an arbitrated question alone, re-arbitrated", () => {
    expect(decideScope(questions, "Q0")).toEqual(
      Either.right({ presented: ["Q0"], reArbitrated: "Q0" }),
    );
  });

  it("refuses an unknown id, naming every question id", () => {
    const scope = decideScope(questions, "Q9");
    expect(Either.isLeft(scope)).toBe(true);
    if (Either.isLeft(scope)) {
      expect(scope.left).toContain("Q9");
      expect(scope.left).toContain("Q1, Q2, Q0");
    }
  });
});

describe("answerStampViolation", () => {
  const current = schemaUrl("spec-document", CURRENT_STAMPS["spec-document"]);

  it("accepts the current stamp", () => {
    expect(answerStampViolation("spec", answer(spec()))).toBeUndefined();
  });

  it("refuses an answer without $schema", () => {
    const { $schema: _schema, ...rest } = answer(spec());
    const message = answerStampViolation("spec", rest);
    expect(message).toContain("carries no $schema");
    expect(message).toContain(current);
  });

  it("refuses an older spec-document stamp by name", () => {
    const older = schemaUrl("spec-document", "0.17.0");
    const message = answerStampViolation("spec", { ...answer(spec()), $schema: older });
    expect(message).toContain(older);
    expect(message).toContain("spec-document 0.17.0");
    expect(message).toContain(current);
  });

  it("refuses a plan-document stamp on a spec", () => {
    const url = schemaUrl("plan-document", CURRENT_STAMPS["plan-document"]);
    const message = answerStampViolation("spec", { ...answer(spec()), $schema: url });
    expect(message).toContain(`names plan-document, not spec-document`);
    expect(message).toContain(url);
  });

  it("refuses an answer that is not an object", () => {
    expect(answerStampViolation("spec", [1])).toContain("not a JSON object");
  });
});

describe("stampSessionVerdicts", () => {
  it("overwrites by and at on a verdict decided in the session", () => {
    const stamped = stampSessionVerdicts(answer(specWithQ1Decided()), context(spec())) as {
      arbitratedQuestions: Array<{ id: string; verdict: Record<string, unknown> }>;
    };
    const q1 = stamped.arbitratedQuestions.find((q) => q.id === "Q1");
    expect(q1?.verdict["by"]).toEqual({ kind: "operator", name: "Ada Lovelace" });
    expect(q1?.verdict["at"]).toBe(AT);
    // A question the session did not take is left alone.
    const q0 = stamped.arbitratedQuestions.find((q) => q.id === "Q0");
    expect(q0?.verdict["by"]).toEqual({ kind: "operator", name: "Grace Hopper" });
  });

  it("fills an absent by and at, so the answer decodes", () => {
    const json = answer(specWithQ1Decided());
    const questions = json["arbitratedQuestions"] as Array<{ verdict: Record<string, unknown> }>;
    const last = questions.at(-1);
    if (last === undefined) throw new Error("no question");
    delete last.verdict["by"];
    delete last.verdict["at"];
    const after = decode(json, context(spec()));
    const q1 = questionsOf(after).arbitratedQuestions.find((q) => q.id === "Q1");
    expect(q1?.verdict.by).toEqual({ kind: "operator", name: "Ada Lovelace" });
    expect(q1?.verdict.at).toBe(AT);
  });

  it("restores a plan's lineage whatever the session said", () => {
    const json = { ...answer(plan()), sourceSpec: null, completesSpec: null };
    const stamped = stampSessionVerdicts(
      json,
      context(plan(), { presented: ["Q1"], reArbitrated: null }),
    ) as Record<string, unknown>;
    expect(stamped["sourceSpec"]).toBe("docs/specs/2609281200-log-rotation.md");
    expect(stamped["completesSpec"]).toBe(true);
  });

  it("keeps a re-arbitrated verdict the session left alone, by and at included", () => {
    const original = spec();
    const json = answer(original);
    const q0 = (json["arbitratedQuestions"] as Array<{ verdict: Record<string, unknown> }>)[0];
    if (q0 === undefined) throw new Error("no question");
    q0.verdict["at"] = "2026-10-19T00:00:00Z";
    const after = decode(json, context(original, { presented: ["Q0"], reArbitrated: "Q0" }));
    expect(after).toEqual(original);
  });
});

describe("decodeRevisedDocument", () => {
  it("decodes a current-shape answer into a document without $schema", () => {
    const after = decode(answer(specWithQ1Decided()), context(spec()));
    expect(after.kind).toBe("spec");
    expect("$schema" in after.document).toBe(false);
  });

  it("refuses a wrong stamp at $schema", () => {
    const json = { ...answer(spec()), $schema: schemaUrl("spec-document", "0.17.0") };
    expect(refusalOf(json, context(spec()))).toMatch(/^\$schema: .*spec-document 0\.17\.0/);
  });

  it("names a chosen option the question does not list", () => {
    const json = answer(specWithQ1Decided(decided(Q1, "Q1-z", { abandoned: ["Q1-a", "Q1-b"] })));
    expect(refusalOf(json, context(spec()))).toMatch(
      /^arbitratedQuestions\[1\]\.verdict\.chosen: "Q1-z" names none/,
    );
  });

  it("names an abandoned list that is not exactly the other options", () => {
    const json = answer(specWithQ1Decided(decided(Q1, "Q1-a", { abandoned: [] })));
    expect(refusalOf(json, context(spec()))).toMatch(
      /^arbitratedQuestions\[1\]\.verdict\.abandoned: misses "Q1-b"/,
    );
  });

  it("names a plan verdict's phase the plan lacks", () => {
    const after = plan({
      openQuestions: [],
      arbitratedQuestions: [
        { ...Q1, verdict: { ...decided(Q1, "Q1-a"), phase: "phase-09" }, history: [] },
      ] as PlanArbitratedQuestion[],
    });
    const message = refusalOf(
      answer(after),
      context(plan(), { presented: ["Q1"], reArbitrated: null }),
    );
    expect(message).toMatch(/^preamble\.arbitratedQuestions\[0\]\.verdict\.phase: "phase-09"/);
  });

  it("names broken traceability", () => {
    const after = specWithQ1Decided();
    const json = answer(after);
    const criteria = json["acceptanceCriteria"] as Array<{ refs: string[] }>;
    const first = criteria[0];
    if (first === undefined) throw new Error("no criterion");
    first.refs = ["5.9"];
    expect(refusalOf(json, context(spec()))).toMatch(
      /^acceptanceCriteria\[0\]\.refs\[0\]: "5\.9" names no requirement/,
    );
  });

  it("refuses unknown keys", () => {
    const json = { ...answer(specWithQ1Decided()), extra: true };
    expect(refusalOf(json, context(spec()))).toContain("extra");
  });
});

describe("firstRevisionViolation", () => {
  it("accepts a presented question decided as recommended", () => {
    expect(violation(specWithQ1Decided())).toBeUndefined();
  });

  it("refuses a question that was not presented moving", () => {
    const after = specWithQ1Decided();
    expect(violation(after, { presented: ["Q2"], reArbitrated: null })).toBe(
      'arbitratedQuestions[1].id: "Q1" was not presented in this session: it stays open',
    );
  });

  it("refuses an undecided open question being edited", () => {
    const after = specWithQ1Decided();
    if (after.kind !== "spec") throw new Error("spec");
    const edited = spec({
      ...after.document,
      openQuestions: [{ ...Q2, rationale: "changed" }],
    });
    expect(violation(edited)).toBe(
      'openQuestions[0].rationale: "Q2" was not decided in this session: it stays as it was',
    );
  });

  it("refuses another arbitrated question being dropped", () => {
    const after = spec({
      openQuestions: [Q2],
      arbitratedQuestions: [arbitrated(Q1, decided(Q1, "Q1-a"))],
    });
    expect(violation(after)).toBe(
      'arbitratedQuestions: "Q0" is missing: every question of the artifact stays in the document',
    );
  });

  it("refuses another arbitrated question being changed", () => {
    const after = spec({
      openQuestions: [Q2],
      arbitratedQuestions: [
        arbitrated(Q0, decided(Q0, "Q0-a", { why: "rewritten" })),
        arbitrated(Q1, decided(Q1, "Q1-a")),
      ],
    });
    expect(violation(after)).toBe(
      'arbitratedQuestions[0].verdict.why: "Q0" is arbitrated and was not re-arbitrated in this session: it stays as it was',
    );
  });

  it("refuses open questions left open being reordered", () => {
    expect(violation(spec({ openQuestions: [Q2, Q1] }))).toBe(
      'openQuestions[0].id: "Q2" is out of place: the questions this session did not move keep their order (Q1, Q2)',
    );
  });

  it("refuses arbitrated questions being reordered, a decided one joining anywhere", () => {
    const Q3 = question("Q3");
    const before = spec({
      arbitratedQuestions: [
        arbitrated(Q0, decided(Q0, "Q0-a")),
        arbitrated(Q3, decided(Q3, "Q3-a")),
      ],
    });
    const after = (order: SpecArbitratedQuestion[]) =>
      spec({ openQuestions: [Q2], arbitratedQuestions: order });
    const [q0, q3] = [arbitrated(Q0, decided(Q0, "Q0-a")), arbitrated(Q3, decided(Q3, "Q3-a"))];
    const q1 = arbitrated(Q1, decided(Q1, "Q1-a"));
    expect(violation(after([q0, q1, q3]), ALL_OPEN, before)).toBeUndefined();
    expect(violation(after([q3, q0, q1]), ALL_OPEN, before)).toBe(
      'arbitratedQuestions[0].id: "Q3" is out of place: the questions this session did not move keep their order (Q0, Q3)',
    );
  });

  it("refuses a moved question whose fields changed", () => {
    const after = specWithQ1Decided();
    if (after.kind !== "spec") throw new Error("spec");
    const changed = spec({
      ...after.document,
      arbitratedQuestions: [
        arbitrated(Q0, decided(Q0, "Q0-a")),
        { ...arbitrated(Q1, decided(Q1, "Q1-a")), question: "Something else?" },
      ],
    });
    expect(violation(changed)).toBe(
      "arbitratedQuestions[1].question: a decided question keeps its question",
    );
  });

  it("refuses a lifted verdict returned for a decided question", () => {
    const after = specWithQ1Decided({
      kind: "lifted",
      chosen: "Q1-a",
      abandoned: ["Q1-b"],
      why: "it was decided",
      at: "2026-10-01",
      by: { kind: "unattributed" },
    });
    expect(violation(after)).toBe(
      'arbitratedQuestions[1].verdict.kind: "Q1" was decided in this session: its verdict is decided, never lifted',
    );
  });

  it("refuses a first verdict with a history", () => {
    const after = spec({
      openQuestions: [Q2],
      arbitratedQuestions: [
        arbitrated(Q0, decided(Q0, "Q0-a")),
        { ...arbitrated(Q1, decided(Q1, "Q1-a")), history: [decided(Q1, "Q1-a")] },
      ],
    });
    expect(violation(after)).toBe(
      'arbitratedQuestions[1].history: "Q1" was open: its history is []',
    );
  });

  describe("re-arbitration", () => {
    const scope: DecideScope = { presented: ["Q0"], reArbitrated: "Q0" };
    const previous = decided(Q0, "Q0-a");
    const next = decided(Q0, "Q0-b", { revised: ["§5.1"] });

    it("accepts a new verdict with the previous one in history", () => {
      const after = spec({
        arbitratedQuestions: [{ ...Q0, verdict: next, history: [previous] }],
        requirements: [
          {
            id: "5.1",
            title: "Rotate weekly",
            pattern: "event",
            statement: "WHEN a week ends THE system SHALL rotate its log.",
          },
        ],
      });
      expect(violation(after, scope)).toBeUndefined();
      const decisions = decidedInSession({ before: spec(), after, scope });
      expect(decisions.map((d) => [d.id, d.departs])).toEqual([["Q0", true]]);
    });

    it("refuses a history without the previous verdict", () => {
      const after = spec({ arbitratedQuestions: [{ ...Q0, verdict: next, history: [] }] });
      expect(violation(after, scope)).toBe(
        'arbitratedQuestions[0].history: "Q0" was re-arbitrated: its history is its earlier history, then its previous verdict',
      );
    });

    it("treats a verdict returned unchanged as not decided", () => {
      const after = spec();
      expect(violation(after, scope)).toBeUndefined();
      expect(decidedInSession({ before: spec(), after, scope })).toEqual([]);
    });

    it("refuses a history edited while the verdict is unchanged", () => {
      const after = spec({
        arbitratedQuestions: [{ ...arbitrated(Q0, previous), history: [previous] }],
      });
      expect(violation(after, scope)).toBe(
        'arbitratedQuestions[0].history[0]: "Q0" was re-arbitrated without a new verdict: it stays as it was',
      );
    });
  });

  it("refuses an unknown principle", () => {
    const after = specWithQ1Decided(decided(Q1, "Q1-a", { principles: ["S1", "S12"] }));
    expect(violation(after)).toMatch(
      /^arbitratedQuestions\[1\]\.verdict\.principles\[1\]: "S12" is no principle id of the loaded doctrine \(E0, C1, S1, S2, X1\)$/,
    );
  });

  it("refuses a departing verdict with an empty revised", () => {
    const after = specWithQ1Decided(decided(Q1, "Q1-b", { revised: [] }));
    expect(violation(after)).toBe(
      'arbitratedQuestions[1].verdict.revised: "Q1-b" departs from the recommendation "Q1-a": name the body sections it revised',
    );
  });

  it("refuses a body change when every revised list is empty", () => {
    const after = specWithQ1Decided();
    if (after.kind !== "spec") throw new Error("spec");
    const changed = spec({ ...after.document, problem: "Logs pile up fast." });
    expect(violation(changed)).toBe(
      "problem: no verdict of this session revised the body (every revised is []): it stays as it was",
    );
  });

  it("accepts a body change named by a departing verdict", () => {
    const after = specWithQ1Decided(decided(Q1, "Q1-b", { revised: ["§2"] }));
    if (after.kind !== "spec") throw new Error("spec");
    expect(violation(spec({ ...after.document, problem: "Logs pile up fast." }))).toBeUndefined();
  });

  it("refuses an unchanged document's body edit when nothing was decided", () => {
    expect(violation(spec({ title: "Log rotation, revised" }))).toBe(
      "title: no verdict of this session revised the body (every revised is []): it stays as it was",
    );
    expect(violation(spec())).toBeUndefined();
  });

  it("checks a plan's preamble arrays and the rest of the plan", () => {
    const scope: DecideScope = { presented: ["Q1"], reArbitrated: null };
    const moved = plan({
      openQuestions: [],
      arbitratedQuestions: [
        { ...Q1, verdict: { ...decided(Q1, "Q1-a"), phase: "phase-01" }, history: [] },
      ] as PlanArbitratedQuestion[],
    });
    expect(violation(moved, scope, plan())).toBeUndefined();
    const edited = plan({
      summary: "Changed.",
      openQuestions: [],
      arbitratedQuestions: (moved.document as PlanDocument).preamble.arbitratedQuestions,
    });
    expect(violation(edited, scope, plan())).toBe(
      "preamble.summary: no verdict of this session revised the body (every revised is []): it stays as it was",
    );
  });
});

describe("decidedInSession", () => {
  it("lists the questions decided in this session, in document order", () => {
    const after = spec({
      openQuestions: [],
      arbitratedQuestions: [
        arbitrated(Q0, decided(Q0, "Q0-a")),
        arbitrated(Q2, decided(Q2, "Q2-b")),
        arbitrated(Q1, decided(Q1, "Q1-a")),
      ],
    });
    expect(
      decidedInSession({ before: spec(), after, scope: ALL_OPEN }).map((d) => [d.id, d.departs]),
    ).toEqual([
      ["Q2", true],
      ["Q1", false],
    ]);
  });

  it("is empty when the document arbitrated nothing", () => {
    expect(decidedInSession({ before: spec(), after: spec(), scope: ALL_OPEN })).toEqual([]);
  });
});

describe("renderRevisedArtifact", () => {
  const FRONTMATTER = "---\nstatus: Draft\n# kept as written\ndate:   2026-09-28\n---\n";

  it("keeps the frontmatter byte for byte and renders the current body", () => {
    const original = FRONTMATTER + renderSpecBody(specDocument());
    const after = specWithQ1Decided();
    const revised = renderRevisedArtifact(original, after);
    expect(revised.md.startsWith(FRONTMATTER)).toBe(true);
    expect(revised.md.slice(FRONTMATTER.length)).toBe(
      renderSpecBody(after.document as SpecDocument),
    );
    expect(revised.sidecarText).toBe(serializeSidecar(after));
  });

  it("renders a plan with empty question arrays to its input", () => {
    const document = planDocument({ openQuestions: [], arbitratedQuestions: [] });
    const original =
      "---\nstatus: Draft\nsource-spec: docs/specs/2609281200-log-rotation.md\ncompletes-spec: true\n---\n" +
      renderPlanBody(document);
    expect(renderRevisedArtifact(original, { kind: "plan", document }).md).toBe(original);
  });
});
