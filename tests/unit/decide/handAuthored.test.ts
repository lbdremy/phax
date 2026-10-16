import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  type ParsedHandQuestions,
  parseHandAuthoredQuestions,
} from "../../../src/domain/artifact/questions.js";
import {
  decodeHandAnswer,
  firstHandAnswerViolation,
  handAnswerStampViolation,
  planPhaseIds,
  stampHandVerdicts,
  writeHandDecisions,
} from "../../../src/domain/decide/handAuthored.js";
import type { DecideScope } from "../../../src/domain/decide/revision.js";
import type { HandDecisionAnswer } from "../../../src/schemas/handDecisionAnswer.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

// Decide on a hand-authored spec or plan (spec artifact-decide §5.6): the
// answer's checks and the in-place writer. Every artifact is made up.

const SPEC = [
  "---",
  "status: Draft",
  "date: 2026-10-01",
  "---",
  "# Log rotation",
  "",
  "## 1. Context",
  "",
  "Every run writes one log.",
  "",
  "## 5. Requirements",
  "",
  "- 5.1 WHEN a run ends THE system SHALL keep its log.",
  "",
  "## 9. Open questions",
  "",
  "### Q1 — Logs: kept per run, or rotated daily?",
  "",
  "- per-run — Kept per run — abandons: a bounded log directory",
  "- daily — Rotated daily — abandons: one log per run",
  "",
  "Recommendation: per-run — a report names its run",
  "",
  "### Q2 — Retention: a week or a month?",
  "",
  "- keep-7 — A week — abandons: a release cycle of logs",
  "- keep-30 — A month — abandons: disk space",
  "",
  "Recommendation: keep-30 — a month covers a release",
  "",
  "## 10. Implementation-planning note",
  "",
  "Settled: none.",
  "",
].join("\n");

// A spec with one open question, one lifted arbitrated question and a log.
const SPEC_ARBITRATED = [
  "---",
  "status: Draft",
  "---",
  "# Log format",
  "",
  "## 5. Requirements",
  "",
  "- 5.1 THE system SHALL write logs as text.",
  "",
  "## 9. Open questions",
  "",
  "### Q1 — Logs: kept per run, or rotated daily?",
  "",
  "- per-run — Kept per run — abandons: a bounded log directory",
  "- daily — Rotated daily — abandons: one log per run",
  "",
  "Recommendation: per-run — a report names its run",
  "",
  "## 9b. Arbitrated questions",
  "",
  "### Q3 — Format: text or JSON lines?",
  "",
  "- text — Plain text — abandons: structure",
  "- json — JSON lines — abandons: grep",
  "",
  "Recommendation: text — people read it",
  "",
  "Decision: text — lifted, unattributed, 2026-09-28",
  "",
  "## 10. Implementation-planning note",
  "",
  "Settled: none.",
  "",
  "## 12. Decision log",
  "",
  "- 2026-09-28 Q3 lifted text — unattributed",
  "",
].join("\n");

const PLAN = [
  "---",
  "status: Draft",
  "source-spec: null",
  "---",
  "# Rotate logs",
  "",
  "Rotate the logs of every run.",
  "",
  "## Required commands",
  "",
  "- (none)",
  "",
  "## Open questions",
  "",
  "### q-scope — Rotate per project or globally?",
  "",
  "- local — Per project — abandons: one shared setting",
  "- global — Globally — abandons: per-project limits",
  "",
  "Recommendation: local — projects differ",
  "",
  "---",
  "",
  "## phase-01 — Rotate {#phase-01-rotate}",
  "",
  "Rotate the logs.",
  "",
  "---",
  "",
  "## phase-02 — Document {#phase-02-docs}",
  "",
  "Document the rotation.",
  "",
].join("\n");

const OPERATOR = { name: "Grace Hopper" };
const AT = "2026-10-16T09:30:00.000Z";
const PRINCIPLES: ReadonlySet<string> = new Set(["S1", "S2", "P1"]);

function parsedOf(kind: "spec" | "plan", md: string): ParsedHandQuestions {
  const parsed = parseHandAuthoredQuestions(kind, md);
  if (parsed.kind !== "parsed") throw new Error(`expected parsed, got ${JSON.stringify(parsed)}`);
  return parsed;
}

function verdict(chosen: string, abandoned: readonly string[], revised: readonly string[] = []) {
  return {
    kind: "decided" as const,
    chosen,
    abandoned,
    why: "a report names its run",
    advocate: "a bounded directory is easier to reason about",
    principles: ["S1"],
    reversibility: "cheap" as const,
    by: { kind: "operator" as const, name: OPERATOR.name },
    at: AT,
    revised,
  };
}

function specAnswer(
  decisions: HandDecisionAnswer["decisions"],
  markdown: string = SPEC,
): HandDecisionAnswer {
  return { kind: "spec", decisions, markdown } as HandDecisionAnswer;
}

const SCOPE_ALL: DecideScope = { presented: ["Q1", "Q2"], reArbitrated: null };

function check(
  answer: HandDecisionAnswer,
  options: { md?: string; kind?: "spec" | "plan"; scope?: DecideScope } = {},
) {
  const kind = options.kind ?? "spec";
  const md = options.md ?? SPEC;
  return firstHandAnswerViolation({
    kind,
    md,
    parsed: parsedOf(kind, md),
    answer,
    scope: options.scope ?? SCOPE_ALL,
    principleIds: PRINCIPLES,
    phaseIds: kind === "plan" ? planPhaseIds(md) : [],
  });
}

function write(
  answer: HandDecisionAnswer,
  options: { md?: string; kind?: "spec" | "plan"; reArbitrated?: string | null } = {},
): string {
  const kind = options.kind ?? "spec";
  const md = options.md ?? SPEC;
  const written = writeHandDecisions({
    kind,
    md,
    answer,
    parsed: parsedOf(kind, md),
    reArbitrated: options.reArbitrated ?? null,
  });
  if (Either.isLeft(written)) throw new Error(written.left);
  return written.right;
}

describe("handAnswerStampViolation", () => {
  const current = currentSchemaUrl("hand-decision-answer");

  it("accepts the current stamp", () => {
    expect(handAnswerStampViolation({ $schema: current })).toBeUndefined();
  });

  it("refuses an answer without $schema, naming the URL phax reads", () => {
    expect(handAnswerStampViolation({ kind: "spec" })).toBe(
      `the answer carries no $schema — phax reads ${current}`,
    );
  });

  it("refuses another format and another release by name", () => {
    const spec = currentSchemaUrl("spec-document");
    expect(handAnswerStampViolation({ $schema: spec })).toBe(
      `$schema ${spec} names spec-document, not hand-decision-answer — phax reads ${current}`,
    );
    const older = schemaUrl("hand-decision-answer", "0.24.0");
    expect(handAnswerStampViolation({ $schema: older })).toBe(
      `$schema ${older} names hand-decision-answer 0.24.0, not its current shape — phax reads ${current}`,
    );
  });

  it("refuses a value that is not an object", () => {
    expect(handAnswerStampViolation([])).toMatch(/^the answer is not a JSON object/);
  });
});

describe("stampHandVerdicts and decodeHandAnswer", () => {
  const raw = {
    $schema: currentSchemaUrl("hand-decision-answer"),
    kind: "spec",
    decisions: [
      {
        id: "Q1",
        verdict: { ...verdict("per-run", ["daily"]), by: { kind: "operator", name: "Someone" } },
      },
      {
        id: "Q2",
        verdict: (({ by: _by, at: _at, ...rest }) => rest)(verdict("keep-30", ["keep-7"])),
      },
    ],
    markdown: SPEC,
  };

  it("overwrites by and at, fills them when absent, and never mutates its input", () => {
    const before = JSON.stringify(raw);
    const stamped = stampHandVerdicts(raw, SCOPE_ALL, OPERATOR, AT) as typeof raw;
    expect(JSON.stringify(raw)).toBe(before);
    for (const decision of stamped.decisions) {
      expect(decision.verdict).toMatchObject({
        by: { kind: "operator", name: "Grace Hopper" },
        at: AT,
      });
    }
  });

  it("leaves a decision of a question not presented as it is", () => {
    const scope: DecideScope = { presented: ["Q1"], reArbitrated: null };
    const stamped = stampHandVerdicts(raw, scope, OPERATOR, AT) as typeof raw;
    expect(stamped.decisions[1]).toEqual(raw.decisions[1]);
  });

  it("decodes a stamped answer without $schema", () => {
    const decoded = decodeHandAnswer(raw, { scope: SCOPE_ALL, operator: OPERATOR, atIso: AT });
    if (Either.isLeft(decoded)) throw new Error(decoded.left.message);
    expect(decoded.right).not.toHaveProperty("$schema");
    expect(decoded.right.decisions[1]?.verdict.by.name).toBe("Grace Hopper");
  });

  it("refuses a wrong stamp at $schema and a schema violation by path", () => {
    const context = { scope: SCOPE_ALL, operator: OPERATOR, atIso: AT };
    const stamp = decodeHandAnswer({ ...raw, $schema: currentSchemaUrl("spec-document") }, context);
    expect(Either.isLeft(stamp) && stamp.left.path).toBe("$schema");
    const unknown = decodeHandAnswer({ ...raw, note: "extra" }, context);
    expect(Either.isLeft(unknown) && unknown.left.path).toBe("note");
  });
});

describe("planPhaseIds", () => {
  it("lists the plan's phase headings in order, outside fenced code", () => {
    const md = `${PLAN}\n\`\`\`\n## phase-09 — Not a phase\n\`\`\`\n`;
    expect(planPhaseIds(md)).toEqual(["phase-01", "phase-02"]);
  });
});

describe("firstHandAnswerViolation", () => {
  it("accepts a valid answer", () => {
    expect(check(specAnswer([{ id: "Q1", verdict: verdict("per-run", ["daily"]) }]))).toBe(
      undefined,
    );
  });

  it("refuses another kind", () => {
    const answer = { ...specAnswer([]), kind: "plan" } as HandDecisionAnswer;
    expect(check(answer)?.path).toBe("kind");
  });

  it("refuses a decision of a question not presented, and one decided twice", () => {
    const scope: DecideScope = { presented: ["Q2"], reArbitrated: null };
    const notPresented = check(specAnswer([{ id: "Q1", verdict: verdict("per-run", ["daily"]) }]), {
      scope,
    });
    expect(notPresented).toEqual({
      path: "decisions[0].id",
      message: '"Q1" was not presented in this session (presented: Q2)',
    });
    const twice = check(
      specAnswer([
        { id: "Q1", verdict: verdict("per-run", ["daily"]) },
        { id: "Q1", verdict: verdict("per-run", ["daily"]) },
      ]),
    );
    expect(twice?.path).toBe("decisions[1].id");
  });

  it("refuses a chosen option the question does not list", () => {
    const violation = check(specAnswer([{ id: "Q1", verdict: verdict("weekly", ["daily"]) }]));
    expect(violation).toEqual({
      path: "decisions[0].verdict.chosen",
      message: `"weekly" names none of the question's options (per-run, daily)`,
    });
  });

  it("refuses abandoned options that are not exactly the others", () => {
    const missing = check(specAnswer([{ id: "Q1", verdict: verdict("per-run", []) }]));
    expect(missing?.path).toBe("decisions[0].verdict.abandoned");
    const chosen = check(specAnswer([{ id: "Q1", verdict: verdict("per-run", ["per-run"]) }]));
    expect(chosen?.path).toBe("decisions[0].verdict.abandoned[0]");
  });

  it("refuses a principle the doctrine does not define", () => {
    const answer = specAnswer([
      { id: "Q1", verdict: { ...verdict("per-run", ["daily"]), principles: ["S12"] } },
    ]);
    expect(check(answer)).toEqual({
      path: "decisions[0].verdict.principles[0]",
      message: '"S12" is no principle id of the loaded doctrine (S1, S2, P1)',
    });
  });

  it("refuses a plan verdict naming a phase the plan lacks", () => {
    const answer = {
      kind: "plan",
      decisions: [
        { id: "q-scope", verdict: { ...verdict("local", ["global"]), phase: "phase-07" } },
      ],
      markdown: PLAN,
    } as HandDecisionAnswer;
    const scope: DecideScope = { presented: ["q-scope"], reArbitrated: null };
    expect(check(answer, { kind: "plan", md: PLAN, scope })).toEqual({
      path: "decisions[0].verdict.phase",
      message: '"phase-07" names none of the plan\'s phases (phase-01, phase-02)',
    });
  });

  it("refuses a departing verdict that names no revised section", () => {
    const violation = check(specAnswer([{ id: "Q1", verdict: verdict("daily", ["per-run"]) }]));
    expect(violation?.path).toBe("decisions[0].verdict.revised");
    expect(violation?.message).toContain('departs from the recommendation "per-run"');
  });

  it.each([
    ["the frontmatter", SPEC.replace("date: 2026-10-01", "date: 2026-10-02")],
    ["the open questions section", SPEC.replace("a month covers a release", "a month is enough")],
    [
      "the decision log",
      `${SPEC}\n## 12. Decision log\n\n- 2026-10-16 Q1 decided per-run — operator (Grace Hopper)\n`,
    ],
  ])("refuses a markdown whose %s differs from the artifact's", (label, markdown) => {
    const answer = specAnswer(
      [{ id: "Q1", verdict: verdict("daily", ["per-run"], ["## 5. Requirements"]) }],
      markdown,
    );
    expect(check(answer)).toEqual({
      path: "markdown",
      message: `${label} differs from the artifact's: phax writes it — return it exactly as it was`,
    });
  });

  it("refuses a markdown that departs from the §9 format", () => {
    const markdown = SPEC.replace("### Q2 — Retention: a week or a month?", "### Q2: Retention");
    const answer = specAnswer(
      [{ id: "Q1", verdict: verdict("daily", ["per-run"], ["## 5. Requirements"]) }],
      markdown,
    );
    expect(check(answer)).toEqual({
      path: "markdown",
      message: "line 24 departs from the §9 format: ### Q2: Retention",
    });
  });

  it("refuses a body edit when every revised list is empty", () => {
    const markdown = SPEC.replace("Every run writes one log.", "Every run writes two logs.");
    const answer = specAnswer([{ id: "Q1", verdict: verdict("per-run", ["daily"]) }], markdown);
    expect(check(answer)).toEqual({
      path: "markdown",
      message:
        "no verdict of this session revised the body (every revised is []): it stays as it was",
    });
  });

  it("accepts a body edit a departing verdict names", () => {
    const markdown = SPEC.replace("SHALL keep its log", "SHALL rotate its log daily");
    const answer = specAnswer(
      [{ id: "Q1", verdict: verdict("daily", ["per-run"], ["## 5. Requirements"]) }],
      markdown,
    );
    expect(check(answer)).toBeUndefined();
  });
});

describe("writeHandDecisions", () => {
  it("moves a decided question under a new arbitrated section and starts the decision log, changing no other line", () => {
    const answer = specAnswer([{ id: "Q1", verdict: verdict("per-run", ["daily"]) }]);
    const expected = [
      "---",
      "status: Draft",
      "date: 2026-10-01",
      "---",
      "# Log rotation",
      "",
      "## 1. Context",
      "",
      "Every run writes one log.",
      "",
      "## 5. Requirements",
      "",
      "- 5.1 WHEN a run ends THE system SHALL keep its log.",
      "",
      "## 9. Open questions",
      "",
      "### Q2 — Retention: a week or a month?",
      "",
      "- keep-7 — A week — abandons: a release cycle of logs",
      "- keep-30 — A month — abandons: disk space",
      "",
      "Recommendation: keep-30 — a month covers a release",
      "",
      "## 9b. Arbitrated questions",
      "",
      "### Q1 — Logs: kept per run, or rotated daily?",
      "",
      "- per-run — Kept per run — abandons: a bounded log directory",
      "- daily — Rotated daily — abandons: one log per run",
      "",
      "Recommendation: per-run — a report names its run",
      "",
      "Decision: per-run — by operator (Grace Hopper), 2026-10-16",
      "Why: a report names its run. Advocate: a bounded directory is easier to reason about. Principles: S1. Reversibility: cheap. Revised: none.",
      "",
      "## 10. Implementation-planning note",
      "",
      "Settled: none.",
      "",
      "## 12. Decision log",
      "",
      "- 2026-10-16 Q1 decided per-run — operator (Grace Hopper)",
      "",
    ];
    expect(write(answer).split("\n")).toEqual(expected);
    expect(parsedOf("spec", write(answer))).toMatchObject({
      open: [{ id: "Q2" }],
      arbitrated: [{ id: "Q1", chosen: "per-run", lifted: false }],
    });
  });

  it("writes nothing when nothing was decided", () => {
    expect(write(specAnswer([]))).toBe(SPEC);
  });

  it("empties the open section to None. and appends after the arbitrated questions", () => {
    const answer = specAnswer(
      [{ id: "Q1", verdict: verdict("per-run", ["daily"]) }],
      SPEC_ARBITRATED,
    );
    const lines = write(answer, { md: SPEC_ARBITRATED }).split("\n");
    const open = lines.indexOf("## 9. Open questions");
    expect(lines.slice(open, open + 4)).toEqual(["## 9. Open questions", "", "None.", ""]);
    const q3 = lines.indexOf("Decision: text — lifted, unattributed, 2026-09-28");
    const q1 = lines.indexOf("### Q1 — Logs: kept per run, or rotated daily?");
    expect(q1).toBeGreaterThan(q3);
    expect(lines.slice(q3 + 1, q1)).toEqual([""]);
    const log = lines.indexOf("## 12. Decision log");
    expect(lines.slice(log)).toEqual([
      "## 12. Decision log",
      "",
      "- 2026-09-28 Q3 lifted text — unattributed",
      "- 2026-10-16 Q1 decided per-run — operator (Grace Hopper)",
      "",
    ]);
    expect(parsedOf("spec", lines.join("\n"))).toMatchObject({
      open: [],
      arbitrated: [{ id: "Q3" }, { id: "Q1" }],
    });
  });

  it("re-arbitrates an arbitrated question, keeping its earlier decision, and carries body edits over", () => {
    const markdown = SPEC_ARBITRATED.replace(
      "SHALL write logs as text.",
      "SHALL write logs as JSON lines.",
    );
    const answer = specAnswer(
      [{ id: "Q3", verdict: verdict("json", ["text"], ["## 5. Requirements"]) }],
      markdown,
    );
    const scope: DecideScope = { presented: ["Q3"], reArbitrated: "Q3" };
    expect(check(answer, { md: SPEC_ARBITRATED, scope })).toBeUndefined();
    const written = write(answer, { md: SPEC_ARBITRATED, reArbitrated: "Q3" });
    const lines = written.split("\n");
    expect(lines).toContain("- 5.1 THE system SHALL write logs as JSON lines.");
    const decision = lines.indexOf("Decision: json — by operator (Grace Hopper), 2026-10-16");
    expect(decision).toBeGreaterThan(0);
    expect(lines[decision + 1]).toMatch(/^Why: a report names its run\./);
    expect(lines[decision + 1]).toContain("Revised: ## 5. Requirements.");
    expect(lines[decision + 2]).toBe("Earlier decision: text — lifted, unattributed, 2026-09-28");
    expect(lines).not.toContain("Decision: text — lifted, unattributed, 2026-09-28");
    expect(lines.slice(lines.indexOf("## 12. Decision log"))).toEqual([
      "## 12. Decision log",
      "",
      "- 2026-09-28 Q3 lifted text — unattributed",
      "- 2026-10-16 Q3 decided json — operator (Grace Hopper) — revised 1 section",
      "",
    ]);
    // Q1 stays open; every line outside the body edit and Q3's Decision block is unchanged.
    expect(parsedOf("spec", written)).toMatchObject({
      open: [{ id: "Q1" }],
      arbitrated: [{ id: "Q3", chosen: "json", lifted: false }],
    });
    const changed = new Set([
      "- 5.1 THE system SHALL write logs as text.",
      "Decision: text — lifted, unattributed, 2026-09-28",
    ]);
    for (const line of SPEC_ARBITRATED.split("\n")) {
      if (!changed.has(line)) expect(lines).toContain(line);
    }
  });

  it("re-arbitrates replacing only the old verdict's lines, keeping earlier decisions and notes in place", () => {
    const md = SPEC_ARBITRATED.replace(
      "Decision: text — lifted, unattributed, 2026-09-28",
      [
        "Decision: text — by operator (Ada Lovelace), 2026-09-28",
        "Why: people read it,",
        "and grep works on it.",
        "Earlier decision: json — lifted, unattributed, 2026-09-01",
        "",
        "Note: revisit after 1.0.",
      ].join("\n"),
    );
    const answer = specAnswer(
      [{ id: "Q3", verdict: verdict("json", ["text"], ["## 5. Requirements"]) }],
      md,
    );
    const written = write(answer, { md, reArbitrated: "Q3" });
    const why =
      "Why: a report names its run. Advocate: a bounded directory is easier to reason about. Principles: S1. Reversibility: cheap. Revised: ## 5. Requirements.";
    const expected = md
      .replace(
        [
          "Decision: text — by operator (Ada Lovelace), 2026-09-28",
          "Why: people read it,",
          "and grep works on it.",
          "Earlier decision: json — lifted, unattributed, 2026-09-01",
        ].join("\n"),
        [
          "Decision: json — by operator (Grace Hopper), 2026-10-16",
          why,
          "Earlier decision: json — lifted, unattributed, 2026-09-01",
          "Earlier decision: text — by operator (Ada Lovelace), 2026-09-28",
        ].join("\n"),
      )
      .replace(
        "- 2026-09-28 Q3 lifted text — unattributed\n",
        "- 2026-09-28 Q3 lifted text — unattributed\n- 2026-10-16 Q3 decided json — operator (Grace Hopper) — revised 1 section\n",
      );
    expect(written).toBe(expected);
    expect(parsedOf("spec", written)).toMatchObject({
      open: [{ id: "Q1" }],
      arbitrated: [{ id: "Q3", chosen: "json", lifted: false }],
    });
  });

  it("re-arbitrates a Decision whose Why is a paragraph of its own", () => {
    const md = SPEC_ARBITRATED.replace(
      "Decision: text — lifted, unattributed, 2026-09-28",
      [
        "Decision: text — by operator (Ada Lovelace), 2026-09-28",
        "",
        "Why: people read it,",
        "and grep works on it.",
        "",
        "Note: revisit after 1.0.",
      ].join("\n"),
    );
    const answer = specAnswer(
      [{ id: "Q3", verdict: verdict("json", ["text"], ["## 5. Requirements"]) }],
      md,
    );
    const lines = write(answer, { md, reArbitrated: "Q3" }).split("\n");
    const decision = lines.indexOf("Decision: json — by operator (Grace Hopper), 2026-10-16");
    expect(lines.slice(decision + 2, decision + 6)).toEqual([
      "Earlier decision: text — by operator (Ada Lovelace), 2026-09-28",
      "",
      "Note: revisit after 1.0.",
      "",
    ]);
    expect(lines).not.toContain("Why: people read it,");
    expect(lines).not.toContain("and grep works on it.");
  });

  it("keeps a CRLF file's line endings", () => {
    const crlf = SPEC.replace(/\n/g, "\r\n");
    const decisions = [{ id: "Q1", verdict: verdict("per-run", ["daily"]) }];
    const written = write(specAnswer(decisions, crlf), { md: crlf });
    expect(written).toBe(write(specAnswer(decisions)).replace(/\n/g, "\r\n"));
    expect(written.replace(/\r\n/g, "")).not.toContain("\n");
    expect(parsedOf("spec", written)).toMatchObject({ arbitrated: [{ id: "Q1" }] });
  });

  it("writes a plan's arbitrated section and decision log before its first phase", () => {
    const answer = {
      kind: "plan",
      decisions: [
        { id: "q-scope", verdict: { ...verdict("local", ["global"]), phase: "phase-01" } },
      ],
      markdown: PLAN,
    } as HandDecisionAnswer;
    const written = write(answer, { kind: "plan", md: PLAN });
    const lines = written.split("\n");
    const phase = lines.indexOf("## phase-01 — Rotate {#phase-01-rotate}");
    const arbitrated = lines.indexOf("## Arbitrated questions");
    const log = lines.indexOf("## Decision log");
    expect(arbitrated).toBeGreaterThan(lines.indexOf("## Open questions"));
    expect(log).toBeGreaterThan(arbitrated);
    expect(phase).toBeGreaterThan(log);
    expect(lines.slice(log, phase)).toEqual([
      "## Decision log",
      "",
      "- 2026-10-16 q-scope decided local — operator (Grace Hopper)",
      "",
      "---",
      "",
    ]);
    expect(written).toContain("Revised: none. Phase: phase-01.");
    expect(lines.slice(lines.indexOf("## Open questions"), arbitrated)).toEqual([
      "## Open questions",
      "",
      "None.",
      "",
    ]);
    expect(parsedOf("plan", written)).toMatchObject({
      open: [],
      arbitrated: [{ id: "q-scope", chosen: "local" }],
    });
    // The phases are untouched.
    expect(written.slice(written.indexOf("---\n\n## phase-01"))).toBe(
      PLAN.slice(PLAN.indexOf("---\n\n## phase-01")),
    );
  });

  it("refuses an answer whose decision names a question it cannot write", () => {
    const answer = specAnswer(
      [{ id: "Q3", verdict: verdict("json", ["text"], ["## 5. Requirements"]) }],
      SPEC_ARBITRATED,
    );
    const written = writeHandDecisions({
      kind: "spec",
      md: SPEC_ARBITRATED,
      answer,
      parsed: parsedOf("spec", SPEC_ARBITRATED),
      reArbitrated: null,
    });
    expect(Either.isLeft(written)).toBe(true);
  });
});
