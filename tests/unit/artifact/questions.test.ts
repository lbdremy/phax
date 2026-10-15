import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  parseHandAuthoredQuestions,
  summarizeDocumentQuestions,
  summarizeParsedQuestions,
} from "../../../src/domain/artifact/questions.js";
import { renderPlanBody } from "../../../src/domain/authoring/renderPlan.js";
import { renderSpecBody } from "../../../src/domain/authoring/renderSpec.js";
import { readPlanDocumentFile, readSpecDocumentFile } from "../../../src/schemas/persisted.js";
import type { PlanDocument } from "../../../src/schemas/planDocument.js";
import type {
  OpenQuestion,
  PlanArbitratedQuestion,
  SpecArbitratedQuestion,
} from "../../../src/schemas/questions.js";
import type { SpecDocument } from "../../../src/schemas/specDocument.js";
import { validDocuments } from "../schemasPackage/documents.js";

const SPEC_FRONTMATTER = "---\nstatus: Draft\ndate: 2026-10-01\n---\n";
const PLAN_FRONTMATTER = "---\nstatus: Draft\nsource-spec: null\n---\n";

function baseSpec(): SpecDocument {
  const doc = readSpecDocumentFile("spec.json", validDocuments["spec-document"]);
  if (Either.isLeft(doc)) throw new Error(doc.left.message);
  return doc.right;
}

function basePlan(): PlanDocument {
  const doc = readPlanDocumentFile("plan.json", validDocuments["plan-document"]);
  if (Either.isLeft(doc)) throw new Error(doc.left.message);
  return doc.right;
}

function question(id: string, optionIds: readonly [string, string]): OpenQuestion {
  return {
    id,
    question: `What about ${id}?`,
    options: optionIds.map((o) => ({ id: o, label: `Option ${o}`, abandons: `the other one` })),
    recommendation: optionIds[0],
    rationale: `the first one is cheaper\nand simpler`,
  };
}

const LIFTED = {
  kind: "lifted",
  why: "Decided by the author on 2026-09-28",
  at: "2026-09-28",
  by: { kind: "unattributed" },
} as const;

const DECIDED = {
  kind: "decided",
  why: "the second one lasts",
  advocate: "the first one is cheaper",
  principles: ["S2"],
  reversibility: "costly",
  by: { kind: "operator", name: "Ada Lovelace" },
  at: "2026-10-20T08:02:11Z",
  revised: ["§5.1"],
} as const;

function specQuestions(): {
  openQuestions: OpenQuestion[];
  arbitratedQuestions: SpecArbitratedQuestion[];
} {
  return {
    openQuestions: [question("q-keep", ["keep-10", "keep-20"]), question("Q4", ["a", "b"])],
    arbitratedQuestions: [
      {
        ...question("Q1", ["manual", "auto"]),
        verdict: { ...LIFTED, chosen: "manual", abandoned: ["auto"] },
        history: [],
      },
      {
        ...question("q-scope", ["local", "global"]),
        verdict: { ...DECIDED, chosen: "global", abandoned: ["local"] },
        history: [],
      },
      {
        // Re-arbitrated: decided against its earlier lifted verdict.
        ...question("Q3", ["trash", "delete"]),
        verdict: { ...DECIDED, chosen: "delete", abandoned: ["trash"] },
        history: [{ ...LIFTED, chosen: "trash", abandoned: ["delete"] }],
      },
    ],
  };
}

function planQuestions(): {
  openQuestions: OpenQuestion[];
  arbitratedQuestions: PlanArbitratedQuestion[];
} {
  const { openQuestions, arbitratedQuestions } = specQuestions();
  return {
    openQuestions,
    arbitratedQuestions: arbitratedQuestions.map((q) => ({
      ...q,
      verdict: q.verdict.kind === "decided" ? { ...q.verdict, phase: "phase-01" } : q.verdict,
      history: q.history.map((v) => (v.kind === "decided" ? { ...v, phase: "phase-01" } : v)),
    })),
  };
}

function shapeOf(parsed: ReturnType<typeof parseHandAuthoredQuestions>) {
  if (parsed.kind !== "parsed") throw new Error(`expected parsed, got ${JSON.stringify(parsed)}`);
  return {
    open: parsed.open.map((q) => ({ id: q.id, optionIds: q.optionIds })),
    arbitrated: parsed.arbitrated.map((q) => ({
      id: q.id,
      optionIds: q.optionIds,
      chosen: q.chosen,
      lifted: q.lifted,
    })),
  };
}

function expectedShape(arrays: ReturnType<typeof specQuestions>) {
  return {
    open: arrays.openQuestions.map((q) => ({ id: q.id, optionIds: q.options.map((o) => o.id) })),
    arbitrated: arrays.arbitratedQuestions.map((q) => ({
      id: q.id,
      optionIds: q.options.map((o) => o.id),
      chosen: q.verdict.chosen,
      lifted: q.verdict.kind === "lifted",
    })),
  };
}

// The 1-based line of the first line of `md` that equals `text`.
function lineOf(md: string, text: string): number {
  const index = md.split("\n").indexOf(text);
  if (index < 0) throw new Error(`no line ${text}`);
  return index + 1;
}

describe("parseHandAuthoredQuestions — round trip through the renderers", () => {
  it("reads back a rendered spec's open, lifted, decided and re-arbitrated questions", () => {
    const arrays = specQuestions();
    const md = SPEC_FRONTMATTER + renderSpecBody({ ...baseSpec(), ...arrays });
    const parsed = parseHandAuthoredQuestions("spec", md);
    expect(shapeOf(parsed)).toEqual(expectedShape(arrays));
    // Lines are 1-based in the whole file, frontmatter included.
    if (parsed.kind === "parsed") {
      expect(parsed.open[0]?.line).toBe(lineOf(md, "### q-keep — What about q-keep?"));
      expect(parsed.arbitrated[2]?.line).toBe(lineOf(md, "### Q3 — What about Q3?"));
    }
  });

  it("reads back a rendered plan's preamble questions", () => {
    const arrays = planQuestions();
    const plan = basePlan();
    const md =
      PLAN_FRONTMATTER + renderPlanBody({ ...plan, preamble: { ...plan.preamble, ...arrays } });
    expect(shapeOf(parseHandAuthoredQuestions("plan", md))).toEqual(expectedShape(arrays));
  });

  it("summarizes a document and its parsed rendering alike", () => {
    const arrays = specQuestions();
    const md = SPEC_FRONTMATTER + renderSpecBody({ ...baseSpec(), ...arrays });
    const parsed = parseHandAuthoredQuestions("spec", md);
    if (parsed.kind !== "parsed") throw new Error("expected parsed");
    const summary = { open: ["q-keep", "Q4"], arbitrated: 3, lifted: 1 };
    expect(summarizeDocumentQuestions(arrays)).toEqual(summary);
    expect(summarizeParsedQuestions(parsed)).toEqual(summary);
  });

  it("reads None. sections as empty, which is not none", () => {
    const md =
      SPEC_FRONTMATTER +
      renderSpecBody({ ...baseSpec(), openQuestions: [], arbitratedQuestions: [] });
    expect(parseHandAuthoredQuestions("spec", md)).toEqual({
      kind: "parsed",
      open: [],
      arbitrated: [],
    });
  });

  it("is none when the artifact has neither section", () => {
    expect(
      parseHandAuthoredQuestions("spec", `${SPEC_FRONTMATTER}# A spec\n\n## 1. Context\n\nText.\n`),
    ).toEqual({
      kind: "none",
    });
    const plan = basePlan();
    expect(parseHandAuthoredQuestions("plan", PLAN_FRONTMATTER + renderPlanBody(plan))).toEqual({
      kind: "none",
    });
  });

  it("ignores a section heading inside a fenced code block", () => {
    const md = `${SPEC_FRONTMATTER}# A spec\n\n\`\`\`\n## 9. Open questions\n\nanything\n\`\`\`\n`;
    expect(parseHandAuthoredQuestions("spec", md)).toEqual({ kind: "none" });
  });
});

describe("parseHandAuthoredQuestions — departures", () => {
  const OPEN_HEAD = `${SPEC_FRONTMATTER}# Log rotation\n\n## 9. Open questions\n\n`;

  it("the older heading followed by a bold question departs at the bold line", () => {
    const md = [
      SPEC_FRONTMATTER + "# Log rotation",
      "",
      "## 9. Open questions for implementation planning",
      "",
      "**Q2 — Logs: kept per run, or rotated daily?**",
      "",
      "- Kept per run — abandons: a bounded log directory",
      "",
    ].join("\n");
    expect(parseHandAuthoredQuestions("spec", md)).toEqual({
      kind: "departs",
      line: 9,
      text: "**Q2 — Logs: kept per run, or rotated daily?**",
    });
  });

  it("an option bullet without an id departs at that bullet", () => {
    const md = [
      `${OPEN_HEAD}### Q2 — Logs: kept per run, or rotated daily?`,
      "",
      "- per-run — Kept per run — abandons: a bounded log directory",
      "- Kept per run — abandons: one log per run",
      "",
      "Recommendation: per-run — a report names its run",
      "",
    ].join("\n");
    expect(parseHandAuthoredQuestions("spec", md)).toEqual({
      kind: "departs",
      line: lineOf(md, "- Kept per run — abandons: one log per run"),
      text: "- Kept per run — abandons: one log per run",
    });
  });

  it("a Decision block in the open section departs at the Decision line", () => {
    const md = [
      `${OPEN_HEAD}### Q2 — Logs?`,
      "",
      "- per-run — Kept per run — abandons: a bounded log directory",
      "- daily — Rotated daily — abandons: one log per run",
      "",
      "Recommendation: per-run — a report names its run",
      "",
      "Decision: per-run — lifted, unattributed, 2026-09-28",
      "",
    ].join("\n");
    expect(parseHandAuthoredQuestions("spec", md)).toEqual({
      kind: "departs",
      line: lineOf(md, "Decision: per-run — lifted, unattributed, 2026-09-28"),
      text: "Decision: per-run — lifted, unattributed, 2026-09-28",
    });
  });

  it("an arbitrated question without a Decision departs at its heading", () => {
    const md = [
      `${SPEC_FRONTMATTER}# Log rotation`,
      "",
      "## 9. Open questions",
      "",
      "None.",
      "",
      "## 9b. Arbitrated questions",
      "",
      "### Q2 — Logs?",
      "",
      "- per-run — Kept per run — abandons: a bounded log directory",
      "- daily — Rotated daily — abandons: one log per run",
      "",
      "Recommendation: per-run — a report names its run",
      "",
      "## 10. Implementation-planning note",
      "",
    ].join("\n");
    expect(parseHandAuthoredQuestions("spec", md)).toEqual({
      kind: "departs",
      line: lineOf(md, "### Q2 — Logs?"),
      text: "### Q2 — Logs?",
    });
  });

  it("a plan question section after the first phase heading departs at its heading", () => {
    const plan = basePlan();
    const md = `${PLAN_FRONTMATTER + renderPlanBody(plan)}\n## Open questions\n\nNone.\n`;
    expect(parseHandAuthoredQuestions("plan", md)).toEqual({
      kind: "departs",
      line: lineOf(md, "## Open questions"),
      text: "## Open questions",
    });
  });

  it("content after None. departs", () => {
    const md = `${OPEN_HEAD}None.\n\n### Q1 — More?\n`;
    expect(parseHandAuthoredQuestions("spec", md)).toEqual({
      kind: "departs",
      line: lineOf(md, "### Q1 — More?"),
      text: "### Q1 — More?",
    });
  });

  it("a Decision line that names no chosen id departs", () => {
    const md = [
      `${SPEC_FRONTMATTER}# Log rotation`,
      "",
      "## 9b. Arbitrated questions",
      "",
      "### Q2 — Logs?",
      "",
      "- per-run — Kept per run — abandons: a bounded log directory",
      "- daily — Rotated daily — abandons: one log per run",
      "",
      "Recommendation: per-run — a report names its run",
      "",
      "Decision: kept per run",
      "",
    ].join("\n");
    expect(parseHandAuthoredQuestions("spec", md)).toMatchObject({
      kind: "departs",
      text: "Decision: kept per run",
    });
  });
});
