// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { decodeSpecDocument, type SpecDocument } from "../../src/schemas/specDocument.js";

function decoded(raw: unknown): SpecDocument {
  const result = decodeSpecDocument(raw);
  if (Either.isLeft(result)) throw new Error(`fixture does not decode: ${result.left.message}`);
  return result.right;
}

function fixture(): SpecDocument {
  return decoded({
    version: 1,
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
}

function sectionOf(md: string, heading: string): string {
  const start = md.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`missing ${heading}`);
  const next = md.indexOf("\n## ", start + heading.length + 2);
  return md.slice(start + 1, next < 0 ? undefined : next);
}

describe("renderSpecBody", () => {
  it("is deterministic: two renderings are identical", () => {
    expect(renderSpecBody(fixture())).toBe(renderSpecBody(fixture()));
  });

  it("emits the title, the ten canonical sections and the docs page, in order", () => {
    const md = renderSpecBody(fixture());
    expect(md.startsWith("# Plan Prune — `phax prune`\n\n## 1. Context\n")).toBe(true);
    const headings = md.split("\n").filter((line) => line.startsWith("## "));
    expect(headings).toEqual([
      "## 1. Context",
      "## 2. Problem",
      "## 3. Product goal",
      "## 4. Terminology",
      "## 5. Functional requirements",
      "## 6. Surface",
      "## 7. Non-goals",
      "## 8. Acceptance criteria",
      "## 9. Open questions for implementation planning",
      "## 10. Implementation-planning note",
      "## 11. Docs page",
    ]);
    expect(md).not.toContain("## Ground");
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("puts the ground into §1 as a trailing list", () => {
    expect(sectionOf(renderSpecBody(fixture()), "## 1. Context")).toBe(
      [
        "## 1. Context",
        "",
        "A slug is held forever by its archived run.",
        "",
        "Ground read:",
        "",
        "- `docs/ideas/plan-prune.md` — the idea this spec makes precise",
        "- `src/app/archive.ts` — where runs are archived",
        "",
      ].join("\n"),
    );
  });

  it("ends §3 with the guiding rule as a blockquote", () => {
    expect(sectionOf(renderSpecBody(fixture()), "## 3. Product goal")).toBe(
      "## 3. Product goal\n\nFree a slug once its run is archived.\n\n> A slug is held only by a live run.\n",
    );
  });

  it("renders terminology bullets and numbered requirement subsections", () => {
    const md = renderSpecBody(fixture());
    expect(sectionOf(md, "## 4. Terminology")).toBe(
      "## 4. Terminology\n\n- **live run** — a run that is not archived\n",
    );
    expect(sectionOf(md, "## 5. Functional requirements")).toBe(
      [
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
      ].join("\n"),
    );
  });

  it("§6 shows only the after block when before is null, labelled blocks otherwise", () => {
    expect(sectionOf(renderSpecBody(fixture()), "## 6. Surface")).toBe(
      [
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
      ].join("\n"),
    );
  });

  it("§6 marks an empty before block rather than emitting nothing", () => {
    const base = fixture();
    const md = renderSpecBody({
      ...base,
      surface: [{ ...base.surface[1]!, before: "" }],
    });
    expect(md).toContain("before: (empty)\n\nafter:\n\n");
  });

  it("§8 renders given/when/then with refs to the requirement numbers", () => {
    expect(sectionOf(renderSpecBody(fixture()), "## 8. Acceptance criteria")).toBe(
      [
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
      ].join("\n"),
    );
  });

  it("§9 shows one abandons line per option and the recommendation line", () => {
    expect(
      sectionOf(renderSpecBody(fixture()), "## 9. Open questions for implementation planning"),
    ).toBe(
      [
        "## 9. Open questions for implementation planning",
        "",
        "### Q1 — Is pruning manual or automatic past `keep`?",
        "",
        "- manual — an explicit `phax prune` — abandons: self-shrinking",
        "- auto — prune at archive time — abandons: later inspection",
        "",
        "Recommendation: manual — an explicit `phax prune` — records already keep the trajectory.",
        "",
      ].join("\n"),
    );
  });

  it("§7 and §9 say None when empty", () => {
    const md = renderSpecBody({ ...fixture(), nonGoals: [], openQuestions: [] });
    expect(sectionOf(md, "## 7. Non-goals")).toBe("## 7. Non-goals\n\nNone.\n");
    expect(sectionOf(md, "## 9. Open questions for implementation planning")).toBe(
      "## 9. Open questions for implementation planning\n\nNone.\n",
    );
  });

  it("§10 renders the settled, left-open and constraints paragraphs", () => {
    expect(sectionOf(renderSpecBody(fixture()), "## 10. Implementation-planning note")).toBe(
      [
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
      ].join("\n"),
    );
  });

  it("§11 renders the page variant", () => {
    expect(sectionOf(renderSpecBody(fixture()), "## 11. Docs page")).toBe(
      [
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

  it("§11 renders the none variant", () => {
    const md = renderSpecBody({
      ...fixture(),
      docsPage: { kind: "none", why: "a phax-internal change with no reader-facing page" },
    });
    expect(sectionOf(md, "## 11. Docs page")).toBe(
      "## 11. Docs page\n\nNone — a phax-internal change with no reader-facing page\n",
    );
  });

  it("normalises CRLF line endings to LF", () => {
    const md = renderSpecBody({ ...fixture(), context: "Line one.\r\nLine two." });
    expect(md).not.toContain("\r");
    expect(md).toContain("Line one.\nLine two.");
  });

  it("matches the full-fixture snapshot", () => {
    expect(renderSpecBody(fixture())).toMatchSnapshot();
  });
});
