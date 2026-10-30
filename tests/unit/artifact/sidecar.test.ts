// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { archivePathFor } from "../../../src/domain/artifact/document.js";
import {
  type SidecarAgreement,
  describeStampedShape,
  inspectSidecar,
  sidecarAgreement,
  sidecarPathFor,
} from "../../../src/domain/artifact/sidecar.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { renderPlanBody } from "../../../src/domain/authoring/renderPlan.js";
import { renderSpecBody } from "../../../src/domain/authoring/renderSpec.js";
import { decodePlanDocumentFile } from "../../../src/schemas/planDocument.js";
import { withSchemaUrl } from "../../../src/schemas/persisted.js";
import {
  SURFACE_SUMMARY_PLACEHOLDER,
  decodeSpecDocumentFile,
} from "../../../src/schemas/specDocument.js";

const SPEC_DOCUMENT = {
  version: 1,
  kind: "spec",
  title: "Plan Prune",
  ground: [{ path: "docs/ideas/plan-prune.md", note: "the idea" }],
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
  ],
  surface: [
    {
      surface: "cli: `phax prune <run>`",
      binding: "normative",
      before: null,
      after: "phax prune usage-cli\n  pruned usage-cli",
    },
  ],
  nonGoals: ["pruning a live run"],
  acceptanceCriteria: [
    {
      id: "AC-1",
      name: "Prune frees the slug",
      given: "an archived run usage-cli",
      when: "`phax prune usage-cli` runs",
      then: "the slug is free",
      refs: ["5.1"],
    },
  ],
  openQuestions: [],
  planningNote: { settled: ["manual prune"], open: [], constraints: [] },
  docsPage: { kind: "none", why: "the CLI reference covers it" },
};

const PRUNE_TEST_LINE_TEXT =
  "Pruning an archived run frees its slug — small · example · the registry after pruning · in-phase";
const PRUNE_TEST_LINE = {
  guarantee: "Pruning an archived run frees its slug",
  size: "small",
  technique: "example",
  oracle: "the registry after pruning",
  loop: "in-phase",
  criterion: null,
};

const PLAN_DOCUMENT = {
  version: 1,
  kind: "plan",
  sourceSpec: null,
  completesSpec: null,
  run: { shortName: "plan-prune", title: "Plan prune", requiredCommands: [] },
  preamble: {
    summary: "One phase: the prune command.",
    requiredCommandsNote: "No extra commands.",
    technicalArbitrations: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "Prune command",
      model: "claude-sonnet-5",
      effort: "high",
      planMarkdownAnchor: "#phase-01-prune-command",
      plannedFilesToCreate: ["src/app/prune.ts"],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "feat(cli): phax prune", body: "Add `phax prune`." },
      objective: "Free a slug once its run is archived.",
      detailedInstructions: ["Add the use case."],
      boundaryContracts: null,
      testStrategy: `- ${PRUNE_TEST_LINE_TEXT}`,
      implementationOrder: ["Use case"],
      excludedScope: [],
      verification: "The `standard` gate profile.",
      expectedHandoff: "The exit codes.",
    },
  ],
};

const SPEC_FRONTMATTER = `---
status: Draft
date: 2026-09-23
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
`;

// SPEC_DOCUMENT and PLAN_DOCUMENT are the shapes 0.16.0 wrote, before
// questions were arbitrated; the current shape adds the question arrays and,
// on each plan phase, a `mode`, an `oracle` and an `assignmentReason`, and
// holds the test strategy as test lines.
const CURRENT_SPEC_DOCUMENT = {
  ...SPEC_DOCUMENT,
  surface: SPEC_DOCUMENT.surface.map(({ surface, ...rest }) => ({
    surface,
    summary: "An operator can free the slug of an archived run.",
    ...rest,
  })),
  arbitratedQuestions: [],
};
const CURRENT_PLAN_DOCUMENT = {
  ...PLAN_DOCUMENT,
  preamble: { ...PLAN_DOCUMENT.preamble, openQuestions: [], arbitratedQuestions: [] },
  phases: PLAN_DOCUMENT.phases.map((phase) => ({
    ...phase,
    testStrategy: [PRUNE_TEST_LINE],
    mode: "headless",
    oracle: null,
    assignmentReason: null,
  })),
};

function specBody(): string {
  const decoded = decodeSpecDocumentFile(JSON.parse(stampedJson("spec-document")));
  if (Either.isLeft(decoded)) throw new Error("fixture spec document must decode");
  return renderSpecBody(decoded.right);
}

function planBody(): string {
  const decoded = decodePlanDocumentFile(JSON.parse(stampedJson("plan-document")));
  if (Either.isLeft(decoded)) throw new Error("fixture plan document must decode");
  return renderPlanBody(decoded.right);
}

/** A sidecar as phax writes it now: `version` dropped, `$schema` first, at the current shape. */
function stampedJson(id: "spec-document" | "plan-document"): string {
  const { version: _version, ...rest } =
    id === "spec-document" ? CURRENT_SPEC_DOCUMENT : CURRENT_PLAN_DOCUMENT;
  return JSON.stringify(withSchemaUrl(id, rest), null, 2);
}

const specJson = stampedJson("spec-document");

/** A sidecar stamped at an older release of its format, in that release's shape. */
function olderJson(id: "spec-document" | "plan-document", release: string, doc: object): string {
  const { version: _version, ...rest } = doc as { readonly version?: number };
  return JSON.stringify({ $schema: schemaUrl(id, release), ...rest }, null, 2);
}

const PLAN_MD = `---\nstatus: Draft\nsource-spec: null\n---\n${planBody()}`;

function messageOf(agreement: SidecarAgreement): string | undefined {
  return typeof agreement === "object" && agreement.kind === "invalid"
    ? agreement.message
    : undefined;
}

describe("sidecarPathFor", () => {
  it("maps a live artifact to the .json beside it", () => {
    expect(sidecarPathFor("docs/specs/2609230835-plan-prune.md")).toBe(
      "docs/specs/2609230835-plan-prune.json",
    );
    expect(sidecarPathFor("docs/plans/2609230835-plan-prune-plan.md")).toBe(
      "docs/plans/2609230835-plan-prune-plan.json",
    );
  });

  it("maps an archived artifact to the archived sidecar", () => {
    expect(sidecarPathFor("docs/specs/archive/2609230835-plan-prune.md")).toBe(
      "docs/specs/archive/2609230835-plan-prune.json",
    );
  });

  it("commutes with archivePathFor", () => {
    const live = "docs/plans/2609230835-plan-prune-plan.md";
    expect(sidecarPathFor(archivePathFor(live))).toBe(archivePathFor(sidecarPathFor(live)));
  });
});

describe("sidecarAgreement", () => {
  it("is in-sync when the body is the sidecar's rendering", () => {
    const md = SPEC_FRONTMATTER + specBody();
    expect(sidecarAgreement({ md, sidecarJson: specJson, kind: "spec" })).toBe("in-sync");
  });

  it("is in-sync for a plan", () => {
    expect(
      sidecarAgreement({ md: PLAN_MD, sidecarJson: stampedJson("plan-document"), kind: "plan" }),
    ).toBe("in-sync");
  });

  it("is invalid for a plan sidecar stamped 0.19.0, written before completesSpec", () => {
    const { completesSpec: _unrecorded, ...older } = PLAN_DOCUMENT;
    const sidecarJson = olderJson("plan-document", "0.19.0", older);
    const agreement = sidecarAgreement({ md: PLAN_MD, sidecarJson, kind: "plan" });
    expect(agreement).toMatchObject({ kind: "invalid" });
    expect(messageOf(agreement)).toContain("completesSpec");
  });

  it("is in-sync for a sidecar written with $schema", () => {
    const specMd = SPEC_FRONTMATTER + specBody();
    const specSidecar = stampedJson("spec-document");
    expect(sidecarAgreement({ md: specMd, sidecarJson: specSidecar, kind: "spec" })).toBe(
      "in-sync",
    );
    const planMd = `---\nstatus: Draft\nsource-spec: null\n---\n${planBody()}`;
    const planSidecar = stampedJson("plan-document");
    expect(sidecarAgreement({ md: planMd, sidecarJson: planSidecar, kind: "plan" })).toBe(
      "in-sync",
    );
  });

  // Agreement compares with the current rendering only: an older sidecar is
  // unmigrated whatever its body, and is read lifted.
  describe("an older sidecar is unmigrated, never compared", () => {
    const MARKED = {
      id: "q-keep",
      question: "How many runs are kept?",
      options: [
        { id: "keep-10", label: "Ten", abandons: "older runs" },
        { id: "keep-20", label: "Twenty", abandons: "disk space" },
      ],
      recommendation: "keep-20",
      rationale: "Decided by the author on 2026-09-30, two weeks are asked for",
    };
    const OPEN = { ...MARKED, id: "q-scope", rationale: "the scope stays local" };
    const QUESTIONED = { ...SPEC_DOCUMENT, openQuestions: [MARKED, OPEN] };

    it("a spec stamped 0.25.0, whose questions are kept as recorded", () => {
      const sidecarJson = olderJson("spec-document", "0.25.0", {
        ...SPEC_DOCUMENT,
        openQuestions: [MARKED],
        arbitratedQuestions: [],
      });
      for (const md of [SPEC_FRONTMATTER + specBody(), SPEC_FRONTMATTER + "# Edited by hand\n"]) {
        const inspection = inspectSidecar({ md, sidecarJson, kind: "spec" });
        expect(inspection.agreement).toEqual({
          kind: "unmigrated",
          format: "spec-document",
          shape: "0.25.0",
        });
        expect(inspection.sidecar?.kind === "spec" && inspection.sidecar.document).toMatchObject({
          openQuestions: [{ id: "q-keep" }],
          arbitratedQuestions: [],
          surface: [{ summary: SURFACE_SUMMARY_PLACEHOLDER }],
        });
      }
    });

    it.each([
      ["a spec stamped 0.17.0", olderJson("spec-document", "0.17.0", QUESTIONED), "0.17.0"],
      ["a spec written before $schema", JSON.stringify(QUESTIONED), "pre-schema"],
    ] as const)("%s, whose questions lift by the marker", (_label, sidecarJson, shape) => {
      for (const md of [SPEC_FRONTMATTER + specBody(), SPEC_FRONTMATTER + "# Edited by hand\n"]) {
        const inspection = inspectSidecar({ md, sidecarJson, kind: "spec" });
        expect(inspection.agreement).toEqual({
          kind: "unmigrated",
          format: "spec-document",
          shape,
        });
        expect(inspection.sidecar?.kind === "spec" && inspection.sidecar.document).toMatchObject({
          openQuestions: [{ id: "q-scope" }],
          arbitratedQuestions: [{ id: "q-keep", verdict: { kind: "lifted", chosen: "keep-20" } }],
        });
      }
    });

    it.each([
      ["a plan stamped 0.20.0", olderJson("plan-document", "0.20.0", PLAN_DOCUMENT), "0.20.0"],
      [
        "a spec-less plan written before $schema",
        JSON.stringify((({ completesSpec: _c, ...p }) => p)(PLAN_DOCUMENT)),
        "pre-schema",
      ],
    ] as const)("%s, lifted with empty preamble questions", (_label, sidecarJson, shape) => {
      const inspection = inspectSidecar({ md: PLAN_MD, sidecarJson, kind: "plan" });
      expect(inspection.agreement).toEqual({ kind: "unmigrated", format: "plan-document", shape });
      const lift =
        inspection.sidecar?.kind === "plan" && inspection.sidecar.shape !== "current"
          ? inspection.sidecar.lift
          : null;
      expect(lift?.kind === "lifted" && lift.document.preamble).toMatchObject({
        openQuestions: [],
        arbitratedQuestions: [],
      });
      expect(lift?.kind === "lifted" && lift.document.phases[0].testStrategy).toEqual([
        PRUNE_TEST_LINE,
      ]);
    });

    it("names the stamped shape", () => {
      expect(describeStampedShape("spec-document", "0.17.0")).toBe("spec-document 0.17.0");
      expect(describeStampedShape("plan-document", "pre-schema")).toBe(
        "plan-document written before $schema",
      );
    });

    it("an invalid sidecar carries no document", () => {
      expect(
        inspectSidecar({ md: PLAN_MD, sidecarJson: "{ nope", kind: "plan" }).sidecar,
      ).toBeNull();
    });
  });

  it("is invalid, naming the sidecar, when a $schema sidecar still carries version", () => {
    const md = SPEC_FRONTMATTER + specBody();
    const both = JSON.stringify({
      ...JSON.parse(stampedJson("spec-document")),
      version: 1,
    });
    const agreement = sidecarAgreement({
      md,
      sidecarJson: both,
      kind: "spec",
      sidecarPath: "docs/specs/2609230835-plan-prune.json",
    });
    expect(agreement).toMatchObject({ kind: "invalid" });
    expect(messageOf(agreement)).toMatch(/^docs\/specs\/2609230835-plan-prune\.json: .*version/);
  });

  it("ignores frontmatter changes (a transition's status rewrite and approval stamp)", () => {
    const md = `---
status: Approved
date: 2026-09-23
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-09-24
  baseline: abc1234
---
${specBody()}`;
    expect(sidecarAgreement({ md, sidecarJson: specJson, kind: "spec" })).toBe("in-sync");
  });

  it("ignores trailing whitespace and line-ending differences", () => {
    const body = specBody()
      .split("\n")
      .map((line) => (line.length > 0 ? `${line}  ` : line))
      .join("\r\n");
    const md = `${SPEC_FRONTMATTER}${body}\n\n\n`;
    expect(sidecarAgreement({ md, sidecarJson: specJson, kind: "spec" })).toBe("in-sync");
  });

  it("is diverged when the body was edited", () => {
    const md = SPEC_FRONTMATTER + specBody().replace("Free a slug", "Release a slug");
    expect(sidecarAgreement({ md, sidecarJson: specJson, kind: "spec" })).toBe("diverged");
  });

  it("is invalid when the sidecar is not JSON", () => {
    const md = SPEC_FRONTMATTER + specBody();
    const agreement = sidecarAgreement({ md, sidecarJson: "{ nope", kind: "spec" });
    expect(agreement).toMatchObject({ kind: "invalid" });
    expect(messageOf(agreement)).toMatch(/^not JSON/);
  });

  it("is invalid when the sidecar fails the kind's document schema, naming the path", () => {
    const md = SPEC_FRONTMATTER + specBody();
    const broken = JSON.stringify({ ...SPEC_DOCUMENT, title: "" });
    const agreement = sidecarAgreement({ md, sidecarJson: broken, kind: "spec" });
    expect(agreement).toMatchObject({ kind: "invalid" });
    expect(messageOf(agreement)).toContain("title");
  });

  it("is invalid when the sidecar is a document of the other kind", () => {
    const md = SPEC_FRONTMATTER + specBody();
    const agreement = sidecarAgreement({
      md,
      sidecarJson: JSON.stringify(PLAN_DOCUMENT),
      kind: "spec",
    });
    expect(agreement).toMatchObject({ kind: "invalid" });
  });
});
