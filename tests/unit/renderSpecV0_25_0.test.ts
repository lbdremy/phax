// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { renderSpecBodyV0_25_0 } from "../../src/domain/authoring/renderSpecV0_25_0.js";
import { decodeSpecDocumentV0_25_0 } from "../../src/schemas/history/spec-document/0.25.0.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import type { SpecDocumentV0_25_0Value } from "../../src/schemas/persisted.js";

// The renderSpec.test.ts fixture as a 0.25.0 sidecar carried it: no summaries.
function fixture(): SpecDocumentV0_25_0Value {
  const result = decodeSpecDocumentV0_25_0({
    $schema: schemaUrl("spec-document", "0.25.0"),
    kind: "spec",
    title: "Plan Prune — `phax prune`",
    ground: [
      { path: "docs/ideas/plan-prune.md", note: "the idea this spec makes precise" },
      { path: "src/app/archive.ts", note: "where runs are archived" },
    ],
    context: "A slug is held forever by its archived run.",
    problem: "The `-2` habit is the visible symptom.",
    productGoal: {
      statement: "Free a slug once its run is archived.",
      guidingRule: "A slug is held only by a live run.",
    },
    terminology: [{ term: "live run", definition: "a run that is not archived" }],
    requirements: [
      {
        id: "R-eligible",
        title: "Prune eligibility",
        pattern: "event",
        statement: "WHEN a run is archived THE system SHALL make it eligible to prune.",
      },
      {
        id: "R-refuse",
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
        after: "phax prune usage-cli\n  pruned usage-cli (archived 2026-09-01)\n  $? = 0",
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
        refs: ["R-eligible"],
      },
      {
        id: "AC-2",
        name: "Live runs are kept",
        given: "a live run usage-cli",
        when: "`phax prune usage-cli` runs",
        then: "it refuses.",
        refs: ["R-refuse", "R-eligible"],
      },
    ],
    openQuestions: [
      {
        id: "prune-mode",
        question: "Is pruning manual or automatic past `keep`?",
        options: [
          { id: "manual", label: "manual — an explicit `phax prune`", abandons: "self-shrinking" },
          { id: "auto", label: "auto — prune at archive time", abandons: "later inspection" },
        ],
        recommendation: "manual",
        rationale: "records already keep the trajectory",
      },
    ],
    arbitratedQuestions: [],
    planningNote: {
      settled: ["manual prune", "exit codes"],
      open: [],
      constraints: ["no new state"],
    },
    docsPage: {
      kind: "page",
      page: "docs/cli/prune.md",
      reader: "an operator whose `-2` runs pile up",
      example: "phax prune usage-cli",
    },
  });
  if (Either.isLeft(result)) throw new Error(`fixture does not decode: ${result.left.message}`);
  const { $schema: _schema, ...value } = result.right;
  return value;
}

describe("renderSpecBodyV0_25_0", () => {
  // The body is copied from the renderSpec snapshot as it stood before the surface summary.
  it("renders exactly the body phax 0.25.0 and 0.26.0 wrote, with no Summary line", () => {
    expect(renderSpecBodyV0_25_0(fixture())).toBe(
      [
        "# Plan Prune — `phax prune`",
        "",
        "## 1. Context",
        "",
        "A slug is held forever by its archived run.",
        "",
        "Ground read:",
        "",
        "- `docs/ideas/plan-prune.md` — the idea this spec makes precise",
        "- `src/app/archive.ts` — where runs are archived",
        "",
        "## 2. Problem",
        "",
        "The `-2` habit is the visible symptom.",
        "",
        "## 3. Product goal",
        "",
        "Free a slug once its run is archived.",
        "",
        "> A slug is held only by a live run.",
        "",
        "## 4. Terminology",
        "",
        "- **live run** — a run that is not archived",
        "",
        "## 5. Functional requirements",
        "",
        "### 5.1 Prune eligibility",
        "",
        "WHEN a run is archived THE system SHALL make it eligible to prune.",
        "",
        "### 5.2 Prune refusal",
        "",
        "IF the run is live THEN the system SHALL refuse to prune it.",
        "",
        "## 6. Surface",
        "",
        "### cli: `phax prune <run>` — normative",
        "",
        "    phax prune usage-cli",
        "      pruned usage-cli (archived 2026-09-01)",
        "      $? = 0",
        "",
        "### config: `phax.json` `archive.prune` — indicative",
        "",
        "before:",
        "",
        '    "archive": { "keep": 10 }',
        "",
        "after:",
        "",
        '    "archive": { "keep": 10, "prune": "manual" }',
        "",
        "## 7. Non-goals",
        "",
        "- pruning a run that is not archived",
        "",
        "## 8. Acceptance criteria",
        "",
        "### Prune frees the slug",
        "",
        "Given an archived run usage-cli, when `phax prune usage-cli` runs, then the slug is free. (refs §5.1)",
        "",
        "### Live runs are kept",
        "",
        "Given a live run usage-cli, when `phax prune usage-cli` runs, then it refuses. (refs §5.2, §5.1)",
        "",
        "## 9. Open questions",
        "",
        "### prune-mode — Is pruning manual or automatic past `keep`?",
        "",
        "- manual — manual — an explicit `phax prune` — abandons: self-shrinking",
        "- auto — auto — prune at archive time — abandons: later inspection",
        "",
        "Recommendation: manual — records already keep the trajectory.",
        "",
        "## 9b. Arbitrated questions",
        "",
        "None.",
        "",
        "## 10. Implementation-planning note",
        "",
        "Settled:",
        "",
        "- manual prune",
        "- exit codes",
        "",
        "Left open: none.",
        "",
        "Constraints:",
        "",
        "- no new state",
        "",
        "## 11. Docs page",
        "",
        "Page: docs/cli/prune.md",
        "",
        "Reader: an operator whose `-2` runs pile up",
        "",
        "Example: phax prune usage-cli",
        "",
      ].join("\n"),
    );
  });
});
