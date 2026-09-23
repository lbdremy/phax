import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { renderPlanBody } from "../../src/domain/authoring/renderPlan.js";
import {
  collectPlanStructureErrors,
  extractPlanDeterministic,
} from "../../src/domain/plan/parsePlanMarkdown.js";
import { finalizeExtractedPlan } from "../../src/domain/plan/finalize.js";
import {
  decodePlanDocument,
  projectExtractedPlan,
  type PlanDocument,
} from "../../src/schemas/planDocument.js";

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
    },
    phases: [
      {
        id: "phase-01",
        title: "Spec and plan document schemas, `artifact schema`",
        model: "claude-opus-5-5",
        effort: "high",
        planMarkdownAnchor: "#phase-01-document-schemas",
        plannedFilesToCreate: ["src/schemas/specDocument.ts", "tests/unit/**/*.test.ts"],
        plannedFilesToEdit: ["src/schemas/phaxPlan.ts", "docs/cli/reference_v2_.md"],
        optionalFilesToEdit: ["docs/cli/inventory.md"],
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
        testStrategy: "Unit, written first: a full valid spec document decodes.",
        implementationOrder: ["Schemas", "Projection", "CLI"],
        excludedScope: ["Rendering (phase-02)."],
        verification: "The `standard` gate profile.",
        expectedHandoff: "The exported names from both schema files.",
      },
      {
        id: "phase-02",
        title: "Renderers",
        model: "claude-sonnet-5",
        effort: "medium",
        planMarkdownAnchor: "#phase-02-renderers",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        commit: { subject: "feat(authoring): renderers", body: "Add the renderers." },
        objective: "Render both documents.",
        detailedInstructions: [],
        boundaryContracts: null,
        testStrategy: "Round trip.",
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
    const md = `---\nstatus: Draft\nsource-spec: ${doc.sourceSpec ?? "null"}\n---\n\n${renderPlanBody(doc)}`;
    expect(collectPlanStructureErrors(md)).toEqual([]);
    const { fromMarkdown, fromDocument } = roundTrip(doc, md);
    expect(fromMarkdown.plan).toEqual(fromDocument.plan);
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
