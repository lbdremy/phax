import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  type DocumentMigration,
  type DocumentMigrationDecision,
  decideDocumentMigration,
  documentMigrationCommitBody,
  groupMigratedArtifacts,
} from "../../../src/domain/artifact/documentMigration.js";
import { renderPlanBody } from "../../../src/domain/authoring/renderPlan.js";
import { renderPlanBodyV0_25_0 } from "../../../src/domain/authoring/renderPlanV0_25_0.js";
import { renderSpecBody } from "../../../src/domain/authoring/renderSpec.js";
import { renderSpecBodyV0_17_0 } from "../../../src/domain/authoring/renderSpecV0_17_0.js";
import {
  type PlanDocumentV0_25_0Value,
  type SpecDocumentV0_17_0Value,
  currentSchemaUrl,
  readPlanDocumentFile,
  readSpecDocumentFile,
} from "../../../src/schemas/persisted.js";
import type { PlanDocument } from "../../../src/schemas/planDocument.js";
import type { OpenQuestion } from "../../../src/schemas/questions.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

// Pure decisions of `phax artifact migrate-documents` (spec artifact-decide
// §5.49, §5.50). Every spec, plan and question here is made up.

const SPEC = "docs/specs/2609281200-log-rotation.md";
const SPEC_SIDECAR = "docs/specs/2609281200-log-rotation.json";
const PLAN = "docs/plans/2609261000-plan-prune-store-plan.md";
const PLAN_SIDECAR = "docs/plans/2609261000-plan-prune-store-plan.json";

// A YAML comment and a blank-ish value layout: kept byte for byte.
const SPEC_FRONTMATTER =
  "---\nstatus: Draft\n# kept as written\ndate: 2026-09-28\naudience:   maintainers\nscope: log rotation\n---\n";
const PLAN_FRONTMATTER = "---\nstatus: Approved\nsource-spec: null\n---\n";

function question(id: string, rationale: string): OpenQuestion {
  return {
    id,
    question: `What about ${id}?`,
    options: [
      { id: `${id}-a`, label: "First", abandons: "the second" },
      { id: `${id}-b`, label: "Second", abandons: "the first" },
    ],
    recommendation: `${id}-a`,
    rationale,
  };
}

const OLDER_SPEC: SpecDocumentV0_17_0Value = {
  kind: "spec",
  title: "Log rotation",
  ground: [{ path: "src/app/logs.ts", note: "where logs are written" }],
  context: "Every run writes one log.",
  problem: "Logs pile up.",
  productGoal: { statement: "Keep logs bounded.", guidingRule: "A log is kept while useful." },
  terminology: [],
  requirements: [
    {
      id: "R-rotate",
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
      refs: ["R-rotate"],
    },
  ],
  openQuestions: [
    question("Q1", "Decided by the author on 2026-09-28, daily keeps it simple"),
    question("Q2", "it is the cheaper choice"),
  ],
  planningNote: { settled: [], open: [], constraints: [] },
  docsPage: { kind: "none", why: "the CLI reference covers it" },
};

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const SPEC_0_17_0_JSON = json({ $schema: schemaUrl("spec-document", "0.17.0"), ...OLDER_SPEC });
const SPEC_PRE_SCHEMA_JSON = json({ version: 1, ...OLDER_SPEC });
const OLDER_SPEC_MD = SPEC_FRONTMATTER + renderSpecBodyV0_17_0(OLDER_SPEC);

const PLAN_0_20_0 = {
  kind: "plan",
  sourceSpec: null,
  completesSpec: null,
  run: { shortName: "plan-prune-store", title: "Plan prune store", requiredCommands: [] },
  preamble: {
    summary: "Two phases: the store, then the command.",
    requiredCommandsNote: "No extra commands.",
    technicalArbitrations: [],
  },
  phases: ["phase-01", "phase-02"].map((id) => ({
    id,
    title: `Step ${id}`,
    model: "claude-sonnet-5",
    effort: "medium",
    planMarkdownAnchor: `#${id}-step`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    commit: { subject: `feat: ${id}`, body: "Do the step." },
    objective: "Do the step.",
    detailedInstructions: [],
    boundaryContracts: null,
    testStrategy: "Unit.",
    implementationOrder: [],
    excludedScope: [],
    verification: "standard",
    expectedHandoff: "Nothing.",
  })),
};
const PLAN_0_20_0_JSON = json({ $schema: schemaUrl("plan-document", "0.20.0"), ...PLAN_0_20_0 });

const REASON = "Designs the prune store, which no code in the repository shows yet.";

// The 0.25.0 shape: questions in the preamble, a `modelReason` on each phase.
const PLAN_0_25_0 = {
  ...PLAN_0_20_0,
  preamble: { ...PLAN_0_20_0.preamble, openQuestions: [], arbitratedQuestions: [] },
  phases: PLAN_0_20_0.phases.map(({ model, effort, ...phase }, i) => ({
    ...phase,
    modelReason: i === 1 ? REASON : null,
    model,
    effort,
  })),
} as unknown as PlanDocumentV0_25_0Value;
const PLAN_0_25_0_JSON = json({ $schema: schemaUrl("plan-document", "0.25.0"), ...PLAN_0_25_0 });

function liftedPlan(): PlanDocument {
  const read = readPlanDocumentFile(PLAN_SIDECAR, JSON.parse(PLAN_0_20_0_JSON));
  if (Either.isLeft(read)) throw new Error(read.left.message);
  return read.right;
}

function migrated(decision: DocumentMigrationDecision): DocumentMigration {
  if (decision.kind !== "migrate") throw new Error(`refused: ${decision.refusal.problem}`);
  return decision.migration;
}

function decideSpec(md: string, sidecarJson: string): DocumentMigrationDecision {
  return decideDocumentMigration({
    kind: "spec",
    path: SPEC,
    sidecarPath: SPEC_SIDECAR,
    md,
    sidecarJson,
  });
}

describe("decideDocumentMigration — specs", () => {
  it("rewrites an in-sync 0.17.0 spec at the current shape, lifting its marked question, keeping its frontmatter", () => {
    const m = migrated(decideSpec(OLDER_SPEC_MD, SPEC_0_17_0_JSON));

    expect(m.status).toBe("Draft");
    expect(m.format).toBe("spec-document");
    expect(m.fromShape).toBe("0.17.0");
    expect(m.questions).toEqual({ open: ["Q2"], arbitrated: 1, lifted: 1 });

    const sidecar = JSON.parse(m.sidecarText) as Record<string, unknown>;
    expect(Object.keys(sidecar)[0]).toBe("$schema");
    expect(sidecar["$schema"]).toBe(currentSchemaUrl("spec-document"));
    expect(m.sidecarText.endsWith("}\n")).toBe(true);
    const read = readSpecDocumentFile(SPEC_SIDECAR, sidecar);
    if (Either.isLeft(read)) throw new Error(read.left.message);
    expect(read.right.openQuestions.map((q) => q.id)).toEqual(["Q2"]);
    const [q1] = read.right.arbitratedQuestions;
    expect(q1?.id).toBe("Q1");
    expect(q1?.verdict).toEqual({
      kind: "lifted",
      chosen: "Q1-a",
      abandoned: ["Q1-b"],
      why: "Decided by the author on 2026-09-28, daily keeps it simple",
      at: "2026-09-28",
      by: { kind: "unattributed" },
    });
    expect(q1?.history).toEqual([]);

    expect(m.md.startsWith(SPEC_FRONTMATTER)).toBe(true);
    expect(m.md).toBe(SPEC_FRONTMATTER + renderSpecBody(read.right));
    expect(m.md).toContain("## 9b. Arbitrated questions");
    expect(m.bodyChanged).toBe(true);
  });

  it("rewrites a spec written before $schema the same way", () => {
    const m = migrated(decideSpec(OLDER_SPEC_MD, SPEC_PRE_SCHEMA_JSON));
    expect(m.fromShape).toBe("pre-schema");
    expect(m.questions).toEqual({ open: ["Q2"], arbitrated: 1, lifted: 1 });
    expect(JSON.parse(m.sidecarText)).not.toHaveProperty("version");
    expect(m.md).toBe(migrated(decideSpec(OLDER_SPEC_MD, SPEC_0_17_0_JSON)).md);
  });

  it("compares as agreement does: trailing whitespace and CRLF in the body are not a hand edit", () => {
    const body = renderSpecBodyV0_17_0(OLDER_SPEC).replace(/\n/g, "  \r\n");
    const m = migrated(decideSpec(`${SPEC_FRONTMATTER}${body}\n\n`, SPEC_0_17_0_JSON));
    expect(m.md.startsWith(SPEC_FRONTMATTER)).toBe(true);
  });

  it("refuses a hand-edited body, naming both remedies", () => {
    const md = OLDER_SPEC_MD.replace("Logs pile up.", "Logs pile up fast.");
    expect(decideSpec(md, SPEC_0_17_0_JSON)).toEqual({
      kind: "refuse",
      refusal: {
        path: SPEC,
        problem:
          "is not its sidecar's spec-document 0.17.0 rendering — a hand edit would be overwritten",
        remedy:
          "Re-author it headless (remove the artifact and its sidecar, then run " +
          "`phax artifact new spec log-rotation --headless --brief <file|->`), " +
          `or delete ${SPEC_SIDECAR} to demote the artifact to hand-authored. Then rerun.`,
      },
    });
  });

  it("refuses a body in the current layout over a 0.17.0 sidecar", () => {
    const current = migrated(decideSpec(OLDER_SPEC_MD, SPEC_0_17_0_JSON)).md;
    expect(decideSpec(current, SPEC_0_17_0_JSON).kind).toBe("refuse");
  });

  it("refuses a sidecar that is not JSON as invalid", () => {
    const decision = decideSpec(OLDER_SPEC_MD, "{ nope");
    expect(decision.kind).toBe("refuse");
    if (decision.kind === "refuse") {
      expect(decision.refusal.problem).toMatch(/^has an invalid sidecar \(not JSON/);
    }
  });
});

describe("decideDocumentMigration — plans", () => {
  it("rewrites a 0.20.0 plan with empty preamble questions, keeping its body byte for byte", () => {
    const md = PLAN_FRONTMATTER + renderPlanBody(liftedPlan());
    const m = migrated(
      decideDocumentMigration({
        kind: "plan",
        path: PLAN,
        sidecarPath: PLAN_SIDECAR,
        md,
        sidecarJson: PLAN_0_20_0_JSON,
      }),
    );

    expect(m.status).toBe("Approved");
    expect(m.fromShape).toBe("0.20.0");
    expect(m.md).toBe(md);
    expect(m.bodyChanged).toBe(false);
    expect(m.questions).toEqual({ open: [], arbitrated: 0, lifted: 0 });
    const sidecar = JSON.parse(m.sidecarText) as {
      $schema: string;
      sourceSpec: unknown;
      completesSpec: unknown;
      preamble: Record<string, unknown>;
    };
    expect(sidecar.$schema).toBe(currentSchemaUrl("plan-document"));
    expect(sidecar.preamble["openQuestions"]).toEqual([]);
    expect(sidecar.preamble["arbitratedQuestions"]).toEqual([]);
    expect([sidecar.sourceSpec, sidecar.completesSpec]).toEqual([null, null]);
  });

  it("keeps a 0.20.0 plan's md untouched even when its body differs only in trailing whitespace", () => {
    const md = `${PLAN_FRONTMATTER}${renderPlanBody(liftedPlan())}\n\n`;
    const m = migrated(
      decideDocumentMigration({
        kind: "plan",
        path: PLAN,
        sidecarPath: PLAN_SIDECAR,
        md,
        sidecarJson: PLAN_0_20_0_JSON,
      }),
    );
    expect(m.md).toBe(md);
    expect(m.bodyChanged).toBe(false);
  });

  it("rewrites a 0.25.0 plan whose body is its 0.25.0 rendering, its Model reason line becoming an Assignment reason line", () => {
    const md = PLAN_FRONTMATTER + renderPlanBodyV0_25_0(PLAN_0_25_0);
    expect(md).toContain(`**Model reason:** ${REASON}`);
    const m = migrated(
      decideDocumentMigration({
        kind: "plan",
        path: PLAN,
        sidecarPath: PLAN_SIDECAR,
        md,
        sidecarJson: PLAN_0_25_0_JSON,
      }),
    );

    expect(m.fromShape).toBe("0.25.0");
    expect(m.bodyChanged).toBe(true);
    expect(m.md).toContain(`**Assignment reason:** ${REASON}`);
    expect(m.md).not.toContain("Model reason");
    expect(m.md.startsWith(PLAN_FRONTMATTER)).toBe(true);
    const sidecar = JSON.parse(m.sidecarText) as {
      $schema: string;
      phases: Array<Record<string, unknown>>;
    };
    expect(sidecar.$schema).toBe(currentSchemaUrl("plan-document"));
    expect(sidecar.phases.map((phase) => phase["assignmentReason"])).toEqual([null, REASON]);
    expect(m.sidecarText).not.toContain("modelReason");
  });

  it("refuses a 0.25.0 plan whose body was edited by hand", () => {
    const md =
      PLAN_FRONTMATTER + renderPlanBodyV0_25_0(PLAN_0_25_0).replace("Unit.", "Unit, by hand.");
    const decision = decideDocumentMigration({
      kind: "plan",
      path: PLAN,
      sidecarPath: PLAN_SIDECAR,
      md,
      sidecarJson: PLAN_0_25_0_JSON,
    });
    expect(decision.kind).toBe("refuse");
    if (decision.kind === "refuse") {
      expect(decision.refusal.problem).toBe(
        "is not its sidecar's plan-document 0.25.0 rendering — a hand edit would be overwritten",
      );
    }
  });

  it("refuses a 0.19.0 plan beside a spec as an invalid sidecar naming completesSpec", () => {
    const { completesSpec: _unrecorded, ...older } = {
      ...PLAN_0_20_0,
      sourceSpec: "docs/specs/2609251400-plan-prune.md",
      completesSpec: true,
    };
    const decision = decideDocumentMigration({
      kind: "plan",
      path: PLAN,
      sidecarPath: PLAN_SIDECAR,
      md: "---\nstatus: Draft\nsource-spec: docs/specs/2609251400-plan-prune.md\ncompletes-spec: true\n---\n# Plan\n",
      sidecarJson: json({ $schema: schemaUrl("plan-document", "0.19.0"), ...older }),
    });
    expect(decision.kind).toBe("refuse");
    if (decision.kind === "refuse") {
      expect(decision.refusal.problem).toMatch(/^has an invalid sidecar \(.*completesSpec/);
      expect(decision.refusal.remedy).toContain(`or delete ${PLAN_SIDECAR} to demote`);
    }
  });
});

describe("groupMigratedArtifacts", () => {
  it("groups specs before plans, by older shape, each naming its format's current stamp", () => {
    const spec = migrated(decideSpec(OLDER_SPEC_MD, SPEC_0_17_0_JSON));
    const preSchema = {
      ...migrated(decideSpec(OLDER_SPEC_MD, SPEC_PRE_SCHEMA_JSON)),
      path: "docs/specs/2609271000-cache-keys.md",
    };
    const plan = migrated(
      decideDocumentMigration({
        kind: "plan",
        path: PLAN,
        sidecarPath: PLAN_SIDECAR,
        md: PLAN_FRONTMATTER + renderPlanBody(liftedPlan()),
        sidecarJson: PLAN_0_20_0_JSON,
      }),
    );

    const groups = groupMigratedArtifacts([
      { migration: plan, editedSinceApproval: false },
      { migration: preSchema, editedSinceApproval: false },
      { migration: spec, editedSinceApproval: true },
    ]);

    expect(groups.map((g) => [g.format, g.fromShape, g.toShape])).toEqual([
      ["spec-document", "0.17.0", CURRENT_STAMPS["spec-document"]],
      ["spec-document", "pre-schema", CURRENT_STAMPS["spec-document"]],
      ["plan-document", "0.20.0", CURRENT_STAMPS["plan-document"]],
    ]);
    expect(groups[0]?.artifacts).toEqual([
      {
        path: SPEC,
        status: "Draft",
        questions: { open: ["Q2"], arbitrated: 1, lifted: 1 },
        bodyChanged: true,
        editedSinceApproval: true,
      },
    ]);
  });

  it("names each rewritten artifact in the commit body", () => {
    const spec = migrated(decideSpec(OLDER_SPEC_MD, SPEC_0_17_0_JSON));
    expect(documentMigrationCommitBody([spec]).split("\n").at(-1)).toBe(
      `- ${SPEC}: spec-document 0.17.0 → ${CURRENT_STAMPS["spec-document"]}`,
    );
  });
});
