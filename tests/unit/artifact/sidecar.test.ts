// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { archivePathFor } from "../../../src/domain/artifact/document.js";
import { sidecarAgreement, sidecarPathFor } from "../../../src/domain/artifact/sidecar.js";
import { renderPlanBody } from "../../../src/domain/authoring/renderPlan.js";
import { renderSpecBody } from "../../../src/domain/authoring/renderSpec.js";
import { decodePlanDocument } from "../../../src/schemas/planDocument.js";
import { decodeSpecDocument } from "../../../src/schemas/specDocument.js";

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

const PLAN_DOCUMENT = {
  version: 1,
  kind: "plan",
  sourceSpec: null,
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
      testStrategy: "Unit.",
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

function specBody(): string {
  const decoded = decodeSpecDocument(SPEC_DOCUMENT);
  if (Either.isLeft(decoded)) throw new Error("fixture spec document must decode");
  return renderSpecBody(decoded.right);
}

function planBody(): string {
  const decoded = decodePlanDocument(PLAN_DOCUMENT);
  if (Either.isLeft(decoded)) throw new Error("fixture plan document must decode");
  return renderPlanBody(decoded.right);
}

const specJson = JSON.stringify(SPEC_DOCUMENT, null, 2);

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
    const md = `---\nstatus: Draft\nsource-spec: null\n---\n${planBody()}`;
    const sidecarJson = JSON.stringify(PLAN_DOCUMENT, null, 2);
    expect(sidecarAgreement({ md, sidecarJson, kind: "plan" })).toBe("in-sync");
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
    expect(typeof agreement === "object" && agreement.message).toMatch(/^not JSON/);
  });

  it("is invalid when the sidecar fails the kind's document schema, naming the path", () => {
    const md = SPEC_FRONTMATTER + specBody();
    const broken = JSON.stringify({ ...SPEC_DOCUMENT, title: "" });
    const agreement = sidecarAgreement({ md, sidecarJson: broken, kind: "spec" });
    expect(agreement).toMatchObject({ kind: "invalid" });
    expect(typeof agreement === "object" && agreement.message).toContain("title");
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
