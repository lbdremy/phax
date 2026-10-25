import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import {
  collectPlanStructureErrors,
  extractPlanDeterministic,
} from "../../src/domain/plan/parsePlanMarkdown.js";
import { finalizeExtractedPlan } from "../../src/domain/plan/finalize.js";
import { readTestStrategyText } from "../../src/domain/plan/testLineGrammar.js";
import {
  decodePlanDocument,
  decodePlanDocumentFile,
  projectExtractedPlan,
  type AuthoredPlanDocument as PlanDocument,
} from "../../src/schemas/planDocument.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";

function decoded(raw: unknown): PlanDocument {
  const result = decodePlanDocument(raw);
  if (Either.isLeft(result)) throw new Error(`fixture does not decode: ${result.left.message}`);
  return result.right;
}

function fixture(): PlanDocument {
  return decoded({
    version: 1,
    kind: "plan",
    sourceSpec: "docs/specs/2609230835-headless-authoring.md",
    completesSpec: true,
    run: {
      shortName: "headless-authoring",
      title: "Headless authoring",
      requiredCommands: ["pnpm gen:usage-spec", "pnpm dev schema upgrade"],
    },
    preamble: {
      summary: "Core to surface: schemas, then renderers.\nEach phase leaves the gates green.",
      requiredCommandsNote: "Both are granted in `security.agentCommands`.",
      technicalArbitrations: [
        "**The cache is keyed on the body.** Accepted loss: one miss per plan.",
        "The brief is read by the CLI.\nRejected: a port for one flag.",
      ],
      openQuestions: [],
      arbitratedQuestions: [],
    },
    phases: [
      {
        id: "phase-01",
        title: "Spec and plan document schemas, `artifact schema`",
        assignmentReason: null,
        model: "claude-opus-5-5",
        effort: "high",
        planMarkdownAnchor: "#phase-01-document-schemas",
        plannedFilesToCreate: ["src/schemas/specDocument.ts", "tests/unit/**/*.test.ts"],
        plannedFilesToEdit: ["src/schemas/phaxPlan.ts", "docs/cli/reference_v2_.md"],
        optionalFilesToEdit: ["docs/cli/inventory.md"],
        mode: "headless",
        oracle: null,
        commit: {
          subject: "feat(schemas): spec and plan document schemas with `phax artifact schema`",
          body: "Add the experimental spec document and plan document formats.\n\n- a strict projection\n- JSON Schema export\n\nUnit-tested; usage spec regenerated.",
        },
        objective: "Introduce the two document formats as Effect Schemas.",
        detailedInstructions: [
          "`src/schemas/specDocument.ts`: the schema.\n### Not a heading: it stays inside the item",
          "Run `pnpm gen:usage-spec`.",
        ],
        boundaryContracts: "Consumer: phase-02's renderers. Producer: this phase.",
        testStrategy: [
          {
            guarantee: "a full valid spec document decodes",
            size: "small",
            technique: "example",
            oracle: "`decodeSpecDocument`'s result",
            loop: "in-phase",
            criterion: null,
          },
          {
            guarantee: "an unknown key is refused",
            size: "small",
            technique: "table",
            oracle: "the refusal message",
            loop: "oracle",
            criterion: "ac-strict",
          },
        ],
        implementationOrder: ["Schemas", "Projection", "CLI"],
        excludedScope: ["Rendering (phase-02)."],
        verification: "The `standard` gate profile.",
        expectedHandoff: "The exported names from both schema files.",
      },
      {
        id: "phase-02",
        title: "Renderers",
        assignmentReason: null,
        model: "claude-sonnet-5",
        effort: "medium",
        planMarkdownAnchor: "#phase-02-renderers",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        mode: "headless",
        oracle: null,
        commit: { subject: "feat(authoring): renderers", body: "Add the renderers." },
        objective: "Render both documents.",
        detailedInstructions: [],
        boundaryContracts: null,
        testStrategy: [],
        implementationOrder: [],
        excludedScope: [],
        verification: "standard",
        expectedHandoff: "The signatures.",
      },
    ],
  });
}

function roundTrip(doc: PlanDocument, md: string) {
  const parsed = extractPlanDeterministic(md);
  if (Either.isLeft(parsed))
    throw new Error(`rendered plan does not parse: ${parsed.left.message}`);
  const fromMarkdown = finalizeExtractedPlan(parsed.right, md);
  const fromDocument = finalizeExtractedPlan(projectExtractedPlan(doc), md);
  if (Either.isLeft(fromMarkdown) || Either.isLeft(fromDocument)) {
    throw new Error("finalize failed");
  }
  return {
    parsed: parsed.right,
    fromMarkdown: fromMarkdown.right,
    fromDocument: fromDocument.right,
  };
}

describe("renderPlanBody round trip through the deterministic parser", () => {
  it("parses back to exactly the document's projection", () => {
    const doc = fixture();
    const md = renderPlanBody(doc);
    const { parsed, fromMarkdown, fromDocument } = roundTrip(doc, md);

    // The raw extraction equals the projection field for field, bar the run
    // short name, which the parser derives from the title (both slugify alike).
    const projection = projectExtractedPlan(doc);
    expect(parsed.phases).toEqual(projection.phases);
    expect(parsed.run.title).toBe(projection.run.title);
    expect(parsed.run.requiredCommands).toEqual(projection.run.requiredCommands);

    expect(fromMarkdown.plan).toEqual(fromDocument.plan);
    expect(fromMarkdown.warnings).toEqual([]);
  });

  it("covers titles, anchors, model/effort, the three lists and the commit fields", () => {
    const doc = fixture();
    const md = renderPlanBody(doc);
    const { fromMarkdown } = roundTrip(doc, md);
    const [first, second] = fromMarkdown.plan.phases;

    expect(first).toEqual({
      id: "phase-01",
      title: "Spec and plan document schemas, `artifact schema`",
      model: "claude-opus-5-5",
      effort: "high",
      planMarkdownAnchor: "#phase-01-document-schemas",
      plannedFilesToCreate: ["src/schemas/specDocument.ts", "tests/unit/**/*.test.ts"],
      plannedFilesToEdit: ["src/schemas/phaxPlan.ts", "docs/cli/reference_v2_.md"],
      optionalFilesToEdit: ["docs/cli/inventory.md"],
      mode: "headless",
      oracle: null,
      commit: {
        subject: "feat(schemas): spec and plan document schemas with `phax artifact schema`",
        body: "Add the experimental spec document and plan document formats.\n\n- a strict projection\n- JSON Schema export\n\nUnit-tested; usage spec regenerated.",
      },
    });
    expect(second).toMatchObject({
      title: "Renderers",
      model: "claude-sonnet-5",
      effort: "medium",
      planMarkdownAnchor: "#phase-02-renderers",
    });
    expect(fromMarkdown.plan.run).toEqual({
      shortName: "headless-authoring",
      title: "Headless authoring",
      branch: "phax/headless-authoring",
      requiredCommands: ["pnpm gen:usage-spec", "pnpm dev schema upgrade"],
    });
  });

  it("renders every empty list as `- (none)` and still parses", () => {
    const doc = fixture();
    const md = renderPlanBody(doc);
    const phase02 = md.slice(md.indexOf("## phase-02"));
    for (const title of [
      "Detailed instructions",
      "Planned files to create",
      "Planned files to edit",
      "Optional files that may be edited",
      "Implementation order",
      "Excluded scope",
    ]) {
      expect(phase02).toContain(`### ${title}\n\n- (none)\n`);
    }
    const { fromMarkdown } = roundTrip(doc, md);
    expect(fromMarkdown.plan.phases[1]).toMatchObject({
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
    });
  });

  it("renders `- (none)` for no required commands and parses to an empty list", () => {
    const base = fixture();
    const doc: PlanDocument = { ...base, run: { ...base.run, requiredCommands: [] } };
    const md = renderPlanBody(doc);
    expect(md).toContain("## Required commands\n\n- (none)\n");
    expect(roundTrip(doc, md).fromMarkdown.plan.run.requiredCommands).toEqual([]);
  });

  it("keeps markup in the run title literal", () => {
    const base = fixture();
    const doc: PlanDocument = {
      ...base,
      run: { ...base.run, title: "Headless `authoring` *now* [v2]" },
    };
    const md = renderPlanBody(doc);
    const { parsed } = roundTrip(doc, md);
    expect(parsed.run.title).toBe("Headless `authoring` *now* [v2]");
  });

  it("parses with a frontmatter block prepended, and lint finds no structure error", () => {
    const doc = fixture();
    const lineage =
      doc.sourceSpec === null
        ? "source-spec: null"
        : `source-spec: ${doc.sourceSpec}\ncompletes-spec: ${String(doc.completesSpec)}`;
    const md = `---\nstatus: Draft\n${lineage}\n---\n\n${renderPlanBody(doc)}`;
    expect(collectPlanStructureErrors(md)).toEqual([]);
    const { fromMarkdown, fromDocument } = roundTrip(doc, md);
    expect(fromMarkdown.plan).toEqual(fromDocument.plan);
  });
});

// The fixture's rendering before plans carried questions, byte for byte.
const BEFORE_QUESTIONS = `# Headless authoring

Core to surface: schemas, then renderers.
Each phase leaves the gates green.

## Required commands

- \`pnpm gen:usage-spec\`
- \`pnpm dev schema upgrade\`

Both are granted in \`security.agentCommands\`.

## Technical arbitrations

- **The cache is keyed on the body.** Accepted loss: one miss per plan.
- The brief is read by the CLI.
  Rejected: a port for one flag.

---

## phase-01 — Spec and plan document schemas, \`artifact schema\` {#phase-01-document-schemas}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Introduce the two document formats as Effect Schemas.

### Detailed instructions

- \`src/schemas/specDocument.ts\`: the schema.
  ### Not a heading: it stays inside the item
- Run \`pnpm gen:usage-spec\`.

### Planned files to create

- \`src/schemas/specDocument.ts\`
- \`tests/unit/**/*.test.ts\`

### Planned files to edit

- \`src/schemas/phaxPlan.ts\`
- \`docs/cli/reference_v2_.md\`

### Optional files that may be edited

- \`docs/cli/inventory.md\`

### Boundary contracts

Consumer: phase-02's renderers. Producer: this phase.

### Test strategy

- a full valid spec document decodes — small · example · \`decodeSpecDocument\`'s result · in-phase
- an unknown key is refused — small · table · the refusal message · oracle · ac-strict

### Implementation order

1. Schemas
2. Projection
3. CLI

### Excluded scope

- Rendering (phase-02).

### Verification

The \`standard\` gate profile.

### Expected handoff content

The exported names from both schema files.

### Commit subject

\`\` feat(schemas): spec and plan document schemas with \`phax artifact schema\` \`\`

### Commit body

Add the experimental spec document and plan document formats.

- a strict projection
- JSON Schema export

Unit-tested; usage spec regenerated.

---

## phase-02 — Renderers {#phase-02-renderers}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Render both documents.

### Detailed instructions

- (none)

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Test strategy

- (none)

### Implementation order

- (none)

### Excluded scope

- (none)

### Verification

standard

### Expected handoff content

The signatures.

### Commit subject

\`feat(authoring): renderers\`

### Commit body

Add the renderers.
`;

// The fixture with one open question and two arbitrated ones: one lifted, one
// decided for phase-02 after an earlier lifted verdict.
// Read as a sidecar: an authoring answer never carries arbitrated questions.
function withQuestions(): PlanDocument {
  const { version, ...base } = fixture();
  const file = decodePlanDocumentFile(
    withSchemaUrl("plan-document", { ...base, preamble: questionPreamble(base.preamble) }),
  );
  if (Either.isLeft(file)) throw new Error(`fixture does not decode: ${file.left.message}`);
  const { $schema: _schema, ...doc } = file.right;
  return { version, ...doc };
}

function questionPreamble(preamble: PlanDocument["preamble"]): unknown {
  return {
    ...preamble,
    openQuestions: [
      {
        id: "q-owner",
        question: "Does phase-01 or phase-02 own the cache write?",
        options: [
          { id: "p1", label: "phase-01 writes it", abandons: "a smaller first phase" },
          { id: "p2", label: "phase-02 writes it", abandons: "an early cache" },
        ],
        recommendation: "p1",
        rationale: "the schema phase already touches the cache",
      },
    ],
    arbitratedQuestions: [
      {
        id: "q-keep",
        question: "How many cache entries are kept?",
        options: [
          { id: "keep-10", label: "Ten", abandons: "older entries" },
          { id: "keep-20", label: "Twenty", abandons: "disk space" },
        ],
        recommendation: "keep-10",
        rationale: "ten covers a working week",
        verdict: {
          kind: "decided",
          chosen: "keep-20",
          abandoned: ["keep-10"],
          why: "two weeks of history are asked for",
          advocate: "ten is enough for most runs",
          principles: ["P2"],
          reversibility: "cheap",
          by: { kind: "operator", name: "Ada Lovelace" },
          at: "2026-10-20T08:02:11Z",
          revised: ["phase-02"],
          phase: "phase-02",
        },
        history: [
          {
            kind: "lifted",
            chosen: "keep-10",
            abandoned: ["keep-20"],
            why: "Decided by the author on 2026-09-28",
            at: "2026-09-28",
            by: { kind: "unattributed" },
          },
        ],
      },
      {
        id: "q-scope",
        question: "Is the cache shared across runs?",
        options: [
          { id: "shared", label: "Shared", abandons: "isolation" },
          { id: "per-run", label: "Per run", abandons: "reuse" },
        ],
        recommendation: "shared",
        rationale: "Decided by the author on 2026-09-30, reuse wins",
        verdict: {
          kind: "lifted",
          chosen: "shared",
          abandoned: ["per-run"],
          why: "Decided by the author on 2026-09-30, reuse wins",
          at: "2026-09-30",
          by: { kind: "unattributed" },
        },
        history: [],
      },
    ],
  };
}

describe("renderPlanBody preamble questions", () => {
  it("renders a plan without questions byte for byte as before questions existed", () => {
    expect(renderPlanBody(fixture())).toBe(BEFORE_QUESTIONS);
  });

  it("renders the three question sections after the arbitrations, before the first phase", () => {
    const md = renderPlanBody(withQuestions());
    const preamble = md.slice(md.indexOf("## Technical arbitrations"), md.indexOf("## phase-01"));
    expect(preamble.slice(preamble.indexOf("## Open questions"))).toBe(
      [
        "## Open questions",
        "",
        "### q-owner — Does phase-01 or phase-02 own the cache write?",
        "",
        "- p1 — phase-01 writes it — abandons: a smaller first phase",
        "- p2 — phase-02 writes it — abandons: an early cache",
        "",
        "Recommendation: p1 — the schema phase already touches the cache.",
        "",
        "## Arbitrated questions",
        "",
        "### q-keep — How many cache entries are kept?",
        "",
        "- keep-10 — Ten — abandons: older entries",
        "- keep-20 — Twenty — abandons: disk space",
        "",
        "Recommendation: keep-10 — ten covers a working week.",
        "",
        "Decision: keep-20 — by operator (Ada Lovelace), 2026-10-20",
        "Why: two weeks of history are asked for. Advocate: ten is enough for most runs. Principles: P2. Reversibility: cheap. Revised: phase-02. Phase: phase-02.",
        "Earlier decision: keep-10 — lifted, unattributed, 2026-09-28",
        "",
        "### q-scope — Is the cache shared across runs?",
        "",
        "- shared — Shared — abandons: isolation",
        "- per-run — Per run — abandons: reuse",
        "",
        "Recommendation: shared — Decided by the author on 2026-09-30, reuse wins.",
        "",
        "Decision: shared — lifted, unattributed, 2026-09-30",
        "",
        "## Decision log",
        "",
        "- 2026-09-28 q-keep lifted keep-10 — unattributed",
        "- 2026-09-30 q-scope lifted shared — unattributed",
        "- 2026-10-20 q-keep decided keep-20 — operator (Ada Lovelace) — revised 1 section",
        "",
        "---",
        "",
        "",
      ].join("\n"),
    );
  });

  it("renders only the open section when nothing is arbitrated", () => {
    const base = withQuestions();
    const md = renderPlanBody({ ...base, preamble: { ...base.preamble, arbitratedQuestions: [] } });
    expect(md).toContain("## Open questions");
    expect(md).not.toContain("## Arbitrated questions");
    expect(md).not.toContain("## Decision log");
  });

  it("projects to the same extracted plan, and lint finds no structure error", () => {
    const doc = withQuestions();
    const md = `---\nstatus: Draft\nsource-spec: ${String(doc.sourceSpec)}\ncompletes-spec: true\n---\n\n${renderPlanBody(doc)}`;
    expect(collectPlanStructureErrors(md)).toEqual([]);
    const { parsed, fromMarkdown, fromDocument } = roundTrip(doc, md);
    expect(parsed.phases).toEqual(projectExtractedPlan(doc).phases);
    expect(parsed.run.requiredCommands).toEqual(["pnpm gen:usage-spec", "pnpm dev schema upgrade"]);
    expect(fromMarkdown.plan).toEqual(fromDocument.plan);
    expect(fromMarkdown.plan).toEqual(
      roundTrip(fixture(), renderPlanBody(fixture())).fromDocument.plan,
    );
  });
});

describe("renderPlanBody shape", () => {
  it("is deterministic and ends with a single newline", () => {
    const md = renderPlanBody(fixture());
    expect(renderPlanBody(fixture())).toBe(md);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("emits the preamble, the phase heading and the recommended lines in order", () => {
    const md = renderPlanBody(fixture());
    expect(md.startsWith("# Headless authoring\n\nCore to surface")).toBe(true);
    expect(md).toContain(
      "## Required commands\n\n- `pnpm gen:usage-spec`\n- `pnpm dev schema upgrade`\n\nBoth are granted",
    );
    expect(md).toContain("## Technical arbitrations\n\n- **The cache is keyed on the body.**");
    expect(md).toContain("- The brief is read by the CLI.\n  Rejected: a port for one flag.");
    expect(md).toContain(
      "---\n\n## phase-01 — Spec and plan document schemas, `artifact schema` {#phase-01-document-schemas}\n\n**Recommended model:** claude-opus-5-5\n**Recommended effort:** high\n\nIntroduce the two",
    );
  });

  it("emits the phase sections in the planning skill's order", () => {
    const md = renderPlanBody(fixture());
    const phase01 = md.slice(md.indexOf("## phase-01"), md.indexOf("## phase-02"));
    const order = [
      "### Detailed instructions",
      "### Planned files to create",
      "### Planned files to edit",
      "### Optional files that may be edited",
      "### Boundary contracts",
      "### Test strategy",
      "### Implementation order",
      "### Excluded scope",
      "### Verification",
      "### Expected handoff content",
      "### Commit subject",
      "### Commit body",
    ];
    const positions = order.map((heading) => phase01.indexOf(`\n${heading}\n`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect(positions).toEqual([...positions].toSorted((a, b) => a - b));
    expect(phase01).toContain("### Implementation order\n\n1. Schemas\n2. Projection\n3. CLI");
  });

  it("omits the technical arbitrations section when there are none", () => {
    const base = fixture();
    const md = renderPlanBody({
      ...base,
      preamble: { ...base.preamble, technicalArbitrations: [] },
    });
    expect(md).not.toContain("## Technical arbitrations");
  });

  it("omits the boundary contracts section when the phase crosses none", () => {
    const md = renderPlanBody(fixture());
    expect(md.slice(md.indexOf("## phase-02"))).not.toContain("### Boundary contracts");
  });

  it("normalises CRLF line endings to LF", () => {
    const base = fixture();
    const md = renderPlanBody({
      ...base,
      preamble: { ...base.preamble, summary: "Line one.\r\nLine two." },
    });
    expect(md).not.toContain("\r");
    expect(md).toContain("Line one.\nLine two.");
  });
});

describe("renderPlanBody with a model reason", () => {
  const REASON = "Designs the invoice state machine, which no code in the repository shows yet.";

  // phase-02 departs to haiku / low with a reason; phase-03 takes the default, with none.
  function reasoned(): PlanDocument {
    const base = fixture();
    const [first, second] = base.phases;
    if (second === undefined) throw new Error("the fixture has two phases");
    return {
      ...base,
      phases: [
        first,
        { ...second, model: "claude-haiku-5-5", effort: "low", assignmentReason: REASON },
        {
          ...second,
          id: "phase-03",
          title: "Defaults",
          planMarkdownAnchor: "#phase-03-defaults",
          model: "claude-sonnet-5-5",
          effort: "medium",
          assignmentReason: null,
        },
      ],
    };
  }

  it("renders the reason line directly under the effort line, in the same paragraph", () => {
    const md = renderPlanBody(reasoned());
    expect(md).toContain(
      `**Recommended model:** claude-haiku-5-5\n**Recommended effort:** low\n**Assignment reason:** ${REASON}\n\n`,
    );
  });

  it("renders no reason line for a null reason, leaving the paragraph as before", () => {
    const md = renderPlanBody(reasoned());
    const phase03 = md.slice(md.indexOf("## phase-03"));
    expect(phase03).toContain(
      "**Recommended model:** claude-sonnet-5-5\n**Recommended effort:** medium\n\n",
    );
    expect(phase03).not.toContain("Assignment reason");
    expect(renderPlanBody(fixture())).not.toContain("Assignment reason");
  });

  it("parses to exactly the projection, with the stated models and efforts and no reason", () => {
    const doc = reasoned();
    const md = renderPlanBody(doc);
    const { parsed, fromMarkdown, fromDocument } = roundTrip(doc, md);
    expect(fromMarkdown.plan).toEqual(fromDocument.plan);
    expect(parsed.phases).toEqual(projectExtractedPlan(doc).phases);
    expect(parsed.phases.map((phase) => [phase.model, phase.effort])).toEqual([
      ["claude-opus-5-5", "high"],
      ["claude-haiku-5-5", "low"],
      ["claude-sonnet-5-5", "medium"],
    ]);
    expect(JSON.stringify(parsed)).not.toContain("assignmentReason");
  });
});

/** One phase's section of a rendered plan, from its heading to the next phase heading. */
function section(md: string, id: string): string {
  const start = md.indexOf(`## ${id}`);
  const next = md.indexOf("\n## phase-", start + 1);
  return md.slice(start, next === -1 ? undefined : next);
}

describe("renderPlanBody with interactive and oracle phases", () => {
  const REASON = "Needs a person to read the screen.";

  // phase-01 is an oracle discharged by phase-03; phase-02 is interactive with
  // a reason; phase-03 is headless with no oracle.
  function kinded(): PlanDocument {
    const base = fixture();
    const [first, second] = base.phases;
    if (first === undefined || second === undefined) throw new Error("the fixture has two phases");
    return {
      ...base,
      phases: [
        {
          ...first,
          oracle: { dischargedBy: "phase-03", files: ["tests/a.test.ts", "tests/b.test.ts"] },
        },
        { ...second, assignmentReason: REASON, mode: "interactive" },
        {
          ...second,
          id: "phase-03",
          title: "Defaults",
          planMarkdownAnchor: "#phase-03-defaults",
        },
      ],
    };
  }

  it("renders the Mode line after the Assignment reason line, in the header paragraph", () => {
    const md = renderPlanBody(kinded());
    expect(section(md, "phase-02")).toContain(
      `**Recommended model:** claude-sonnet-5\n**Recommended effort:** medium\n**Assignment reason:** ${REASON}\n**Mode:** interactive\n\n`,
    );
  });

  it("renders the oracle lines, files as comma-separated code spans, after the effort line", () => {
    const md = renderPlanBody(kinded());
    expect(section(md, "phase-01")).toContain(
      "**Recommended model:** claude-opus-5-5\n**Recommended effort:** high\n**Oracle phase:** discharged by phase-03\n**Oracle files:** `tests/a.test.ts`, `tests/b.test.ts`\n\n",
    );
  });

  it("renders no Mode or oracle line on a headless phase without an oracle", () => {
    const md = renderPlanBody(kinded());
    for (const text of [section(md, "phase-03"), renderPlanBody(fixture())]) {
      expect(text).not.toContain("**Mode:**");
      expect(text).not.toContain("**Oracle");
    }
    expect(section(md, "phase-01")).not.toContain("**Mode:**");
    expect(section(md, "phase-02")).not.toContain("**Oracle");
  });

  it("parses to exactly the projection, mode and oracle included", () => {
    const doc = kinded();
    const md = renderPlanBody(doc);
    const { parsed, fromMarkdown, fromDocument } = roundTrip(doc, md);
    expect(fromMarkdown.plan).toEqual(fromDocument.plan);
    expect(parsed.phases).toEqual(projectExtractedPlan(doc).phases);
    expect(parsed.phases.map((phase) => [phase.mode, phase.oracle])).toEqual([
      ["headless", { dischargedBy: "phase-03", files: ["tests/a.test.ts", "tests/b.test.ts"] }],
      ["interactive", null],
      ["headless", null],
    ]);
  });
});

// Each phase's `### Test strategy` section text, in plan order.
function strategySections(md: string): string[] {
  return md
    .split("\n### Test strategy\n\n")
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("\n\n### ")));
}

describe("renderPlanBody test lines", () => {
  it("reads each rendered section back to the phase's lines, the criterion suffix only where a line names one", () => {
    const doc = fixture();
    const sections = strategySections(renderPlanBody(doc));
    expect(sections).toEqual([
      "- a full valid spec document decodes — small · example · `decodeSpecDocument`'s result · in-phase\n" +
        "- an unknown key is refused — small · table · the refusal message · oracle · ac-strict",
      "- (none)",
    ]);
    expect(
      sections.map((text) => readTestStrategyText(text).lines.map(({ line }) => line)),
    ).toEqual(doc.phases.map((phase) => phase.testStrategy));
    expect(sections.map((text) => readTestStrategyText(text).departures)).toEqual([[], []]);
  });

  it("writes backticks and markup verbatim, never escaped", () => {
    const base = fixture();
    const [first, ...rest] = base.phases;
    const line = {
      guarantee: "a *starred* `code` <tag> guarantee",
      size: "large",
      technique: "smoke",
      oracle: "`a · b` # [link]",
      loop: "in-phase",
      criterion: null,
    } as const;
    const doc = { ...base, phases: [{ ...first, testStrategy: [line] }, ...rest] } as const;
    const [strategy] = strategySections(renderPlanBody(doc));
    expect(strategy).toBe(
      "- a *starred* `code` <tag> guarantee — large · smoke · `a · b` # [link] · in-phase",
    );
    expect(readTestStrategyText(strategy ?? "").lines.map((l) => l.line)).toEqual([line]);
  });
});
