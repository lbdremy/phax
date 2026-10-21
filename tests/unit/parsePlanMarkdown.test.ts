import { describe, it, expect } from "vitest";
import { Either } from "effect";
import {
  extractPlanDeterministic,
  collectPlanStructureErrors,
} from "../../src/domain/plan/parsePlanMarkdown.js";

function makePhase(
  overrides: {
    id?: string;
    anchor?: string;
    title?: string;
    model?: string;
    effort?: string;
    reason?: string;
    /** Header lines after the effort and reason lines: Mode, Oracle phase, Oracle files. */
    header?: readonly string[];
    create?: string;
    edit?: string;
    optional?: string;
    subject?: string;
    body?: string;
  } = {},
): string {
  const id = overrides.id ?? "phase-01";
  const anchor = overrides.anchor ?? `${id}-alpha`;
  const title = overrides.title ?? "Alpha";
  const model = overrides.model ?? "claude-opus-4-8";
  const effort = overrides.effort ?? "medium";
  const create = overrides.create ?? "- src/foo.ts";
  const edit = overrides.edit ?? "- src/bar.ts";
  const optional = overrides.optional ?? "- (none)";
  const subject = overrides.subject ?? `feat(${id}): do a thing`;
  const body = overrides.body ?? "Body one line.";
  return [
    `## ${id} — ${title} {#${anchor}}`,
    ``,
    `**Recommended model:** ${model}`,
    `**Recommended effort:** ${effort}` +
      (overrides.reason === undefined ? "" : `\n**Assignment reason:** ${overrides.reason}`) +
      (overrides.header ?? []).map((line) => `\n${line}`).join(""),
    ``,
    `### Planned files to create`,
    ``,
    create,
    ``,
    `### Planned files to edit`,
    ``,
    edit,
    ``,
    `### Optional files that may be edited`,
    ``,
    optional,
    ``,
    `### Commit subject`,
    ``,
    subject,
    ``,
    `### Commit body`,
    ``,
    body,
  ].join("\n");
}

function makePlan(
  opts: {
    title?: string;
    requiredCommands?: string;
    phases?: string[];
    extraContext?: string;
  } = {},
): string {
  const title = opts.title ?? "Deterministic plan";
  const rc = opts.requiredCommands ?? "- (none)";
  const phases = opts.phases ?? [makePhase()];
  return [
    `# ${title}`,
    ``,
    opts.extraContext ?? "",
    `## Required commands`,
    ``,
    rc,
    ``,
    ...phases.flatMap((p) => [p, "", "---", ""]),
  ].join("\n");
}

describe("extractPlanDeterministic", () => {
  it("extracts a conforming multi-phase plan", () => {
    const md = makePlan({
      title: "Deterministic plan",
      requiredCommands: "- pnpm add\n- pnpm test",
      phases: [
        makePhase({
          id: "phase-01",
          anchor: "phase-01-alpha",
          title: "Alpha",
          model: "claude-opus-4-8",
          effort: "medium",
          create: "- src/a.ts\n- src/b.ts",
          edit: "- package.json",
          optional: "- (none)",
          subject: "feat(a): alpha",
          body: "Alpha body paragraph.",
        }),
        makePhase({
          id: "phase-02",
          anchor: "phase-02-beta",
          title: "Beta",
          model: "claude-sonnet-4-6",
          effort: "low",
          create: "- src/c.ts",
          edit: "- src/d.ts",
          optional: "- src/e.ts",
          subject: "feat(b): beta",
          body: "Beta body paragraph.",
        }),
      ],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right).toEqual({
      version: 1,
      run: {
        shortName: "Deterministic plan",
        title: "Deterministic plan",
        requiredCommands: ["pnpm add", "pnpm test"],
      },
      phases: [
        {
          id: "phase-01",
          model: "claude-opus-4-8",
          effort: "medium",
          planMarkdownAnchor: "#phase-01-alpha",
          plannedFilesToCreate: ["src/a.ts", "src/b.ts"],
          plannedFilesToEdit: ["package.json"],
          optionalFilesToEdit: [],
          mode: "headless",
          oracle: null,
          commit: { subject: "feat(a): alpha", body: "Alpha body paragraph." },
        },
        {
          id: "phase-02",
          model: "claude-sonnet-4-6",
          effort: "low",
          planMarkdownAnchor: "#phase-02-beta",
          plannedFilesToCreate: ["src/c.ts"],
          plannedFilesToEdit: ["src/d.ts"],
          optionalFilesToEdit: ["src/e.ts"],
          mode: "headless",
          oracle: null,
          commit: { subject: "feat(b): beta", body: "Beta body paragraph." },
        },
      ],
    });
  });

  it("treats `- (none)` as an empty list in required commands and planned file sections", () => {
    const md = makePlan({
      requiredCommands: "- (none)",
      phases: [
        makePhase({
          create: "- (none)",
          edit: "- (none)",
          optional: "- (none)",
        }),
      ],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.run.requiredCommands).toEqual([]);
    expect(result.right.phases[0]!.plannedFilesToCreate).toEqual([]);
    expect(result.right.phases[0]!.plannedFilesToEdit).toEqual([]);
    expect(result.right.phases[0]!.optionalFilesToEdit).toEqual([]);
  });

  it("stores a backtick-wrapped commit subject unwrapped", () => {
    const md = makePlan({
      phases: [makePhase({ subject: "`feat(x): backtick subject`" })],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.phases[0]!.commit.subject).toBe("feat(x): backtick subject");
  });

  it("preserves the author's line wrapping in a commit body paragraph verbatim", () => {
    const wrapped = [
      "This is a commit body the author hard-wrapped",
      "across three source",
      "lines.",
    ].join("\n");
    const md = makePlan({ phases: [makePhase({ body: wrapped })] });
    const result = extractPlanDeterministic(md);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.phases[0]!.commit.body).toBe(wrapped);
  });

  it("preserves blank-line paragraph breaks in a multi-paragraph commit body", () => {
    const body = [
      "First paragraph wrapped",
      "over two lines.",
      "",
      "Second paragraph also",
      "wrapped.",
    ].join("\n");
    const md = makePlan({ phases: [makePhase({ body })] });
    const result = extractPlanDeterministic(md);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.phases[0]!.commit.body).toBe(body);
  });

  it("preserves list structure in a commit body", () => {
    const body = ["Summary line.", "", "- first item", "- second item"].join("\n");
    const md = makePlan({ phases: [makePhase({ body })] });
    const result = extractPlanDeterministic(md);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.phases[0]!.commit.body).toBe(body);
  });

  it("parses em-dash, en-dash, and hyphen heading separators", () => {
    for (const sep of ["—", "–", "-"]) {
      const md = makePlan({
        phases: [
          [
            `## phase-01 ${sep} Alpha {#phase-01-alpha}`,
            ``,
            `**Recommended model:** claude-opus-4-8`,
            `**Recommended effort:** medium`,
            ``,
            `### Planned files to create`,
            ``,
            `- (none)`,
            ``,
            `### Planned files to edit`,
            ``,
            `- (none)`,
            ``,
            `### Optional files that may be edited`,
            ``,
            `- (none)`,
            ``,
            `### Commit subject`,
            ``,
            `feat: dash ${sep}`,
            ``,
            `### Commit body`,
            ``,
            `Body.`,
          ].join("\n"),
        ],
      });
      const result = extractPlanDeterministic(md);
      expect(Either.isRight(result), `separator ${sep}`).toBe(true);
    }
  });

  it("fails when the Recommended model line is missing", () => {
    const md = makePlan({
      phases: [
        [
          `## phase-01 — Alpha {#phase-01-alpha}`,
          ``,
          `**Recommended effort:** medium`,
          ``,
          `### Planned files to create`,
          ``,
          `- (none)`,
          ``,
          `### Planned files to edit`,
          ``,
          `- (none)`,
          ``,
          `### Optional files that may be edited`,
          ``,
          `- (none)`,
          ``,
          `### Commit subject`,
          ``,
          `feat: x`,
          ``,
          `### Commit body`,
          ``,
          `Body.`,
        ].join("\n"),
      ],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toMatch(/phase-01/);
      expect(result.left.message).toMatch(/Recommended model/i);
    }
  });

  it("fails when a phase heading has no {#anchor}", () => {
    const md = makePlan({
      phases: [
        [
          `## phase-01 — Alpha`,
          ``,
          `**Recommended model:** claude-opus-4-8`,
          `**Recommended effort:** medium`,
          ``,
          `### Planned files to create`,
          ``,
          `- (none)`,
          ``,
          `### Planned files to edit`,
          ``,
          `- (none)`,
          ``,
          `### Optional files that may be edited`,
          ``,
          `- (none)`,
          ``,
          `### Commit subject`,
          ``,
          `feat: x`,
          ``,
          `### Commit body`,
          ``,
          `Body.`,
        ].join("\n"),
      ],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toMatch(/anchor/i);
    }
  });

  it("fails when a planned-file section is missing", () => {
    const md = makePlan({
      phases: [
        [
          `## phase-01 — Alpha {#phase-01-alpha}`,
          ``,
          `**Recommended model:** claude-opus-4-8`,
          `**Recommended effort:** medium`,
          ``,
          `### Planned files to edit`,
          ``,
          `- (none)`,
          ``,
          `### Optional files that may be edited`,
          ``,
          `- (none)`,
          ``,
          `### Commit subject`,
          ``,
          `feat: x`,
          ``,
          `### Commit body`,
          ``,
          `Body.`,
        ].join("\n"),
      ],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toMatch(/phase-01/);
      expect(result.left.message).toMatch(/Planned files to create/);
    }
  });

  it("fails on an invalid effort value", () => {
    const md = makePlan({
      phases: [makePhase({ effort: "extreme" })],
    });
    const result = extractPlanDeterministic(md);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toMatch(/phase-01/);
      expect(result.left.message).toMatch(/effort/i);
    }
  });

  it("extracts a frontmatter-carrying plan identically to its header-line equivalent", () => {
    const headerLineMd = makePlan({
      title: "Frontmatter parity plan",
      requiredCommands: "- pnpm add\n- pnpm test",
      phases: [
        makePhase({
          create: "- src/a.ts",
          edit: "- package.json",
          optional: "- (none)",
          subject: "feat(x): frontmatter parity",
          body: [
            "This is a hard-wrapped commit body",
            "spanning several source",
            "lines.",
            "",
            "- with a list item",
            "- and another",
          ].join("\n"),
        }),
      ],
    });
    const frontmatterMd = [
      "---",
      "status: Approved",
      "source-spec: null",
      "---",
      "",
      headerLineMd,
    ].join("\n");

    const headerResult = extractPlanDeterministic(headerLineMd);
    const frontmatterResult = extractPlanDeterministic(frontmatterMd);
    expect(Either.isRight(headerResult)).toBe(true);
    expect(Either.isRight(frontmatterResult)).toBe(true);
    if (!Either.isRight(headerResult) || !Either.isRight(frontmatterResult)) return;
    expect(frontmatterResult.right).toEqual(headerResult.right);
  });
});

describe("collectPlanStructureErrors", () => {
  it("accumulates every structural error in document order, split by phase", () => {
    const phase02MissingEditSection = [
      `## phase-02 — Beta {#phase-02-beta}`,
      ``,
      `**Recommended model:** claude-opus-4-8`,
      `**Recommended effort:** medium`,
      ``,
      `### Planned files to create`,
      ``,
      `- (none)`,
      ``,
      `### Optional files that may be edited`,
      ``,
      `- (none)`,
      ``,
      `### Commit subject`,
      ``,
      `feat(b): beta`,
      ``,
      `### Commit body`,
      ``,
      `Beta body.`,
    ].join("\n");
    const phase03MissingEffortAndEmptySubject = [
      `## phase-03 — Gamma {#phase-03-gamma}`,
      ``,
      `**Recommended model:** claude-opus-4-8`,
      `**Recommended effort:**`,
      ``,
      `### Planned files to create`,
      ``,
      `- (none)`,
      ``,
      `### Planned files to edit`,
      ``,
      `- (none)`,
      ``,
      `### Optional files that may be edited`,
      ``,
      `- (none)`,
      ``,
      `### Commit subject`,
      ``,
      "``",
      ``,
      `### Commit body`,
      ``,
      `Gamma body.`,
    ].join("\n");
    const md = makePlan({
      phases: [
        makePhase({ id: "phase-01", anchor: "phase-01-alpha" }),
        phase02MissingEditSection,
        phase03MissingEffortAndEmptySubject,
      ],
    });

    const errors = collectPlanStructureErrors(md);

    expect(errors).toEqual([
      { phase: "phase-02", message: `missing "### Planned files to edit" section` },
      { phase: "phase-03", message: `missing "Recommended effort:" value` },
      { phase: "phase-03", message: `empty commit subject` },
    ]);
  });

  it("still returns the first error, re-prefixed, from extractPlanDeterministic", () => {
    const phase02MissingEditSection = [
      `## phase-02 — Beta {#phase-02-beta}`,
      ``,
      `**Recommended model:** claude-opus-4-8`,
      `**Recommended effort:** medium`,
      ``,
      `### Planned files to create`,
      ``,
      `- (none)`,
      ``,
      `### Optional files that may be edited`,
      ``,
      `- (none)`,
      ``,
      `### Commit subject`,
      ``,
      `feat(b): beta`,
      ``,
      `### Commit body`,
      ``,
      `Beta body.`,
    ].join("\n");
    const md = makePlan({
      phases: [makePhase({ id: "phase-01", anchor: "phase-01-alpha" }), phase02MissingEditSection],
    });

    const result = extractPlanDeterministic(md);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toBe(`phase-02: missing "### Planned files to edit" section`);
    }
  });

  it("reports a plan-level error with a null phase", () => {
    const md = [
      `# Deterministic plan`,
      ``,
      makePhase({ id: "phase-01", anchor: "phase-01-alpha" }),
      ``,
      `---`,
      ``,
    ].join("\n");

    const errors = collectPlanStructureErrors(md);

    expect(errors).toContainEqual({
      phase: null,
      message: `missing "## Required commands" section`,
    });
  });
});

// A plan's preamble may carry question sections in the §9 format, between
// `## Required commands` and the first phase; the projection never reads them.
describe("preamble question sections", () => {
  const QUESTIONS = [
    "## Open questions",
    "",
    "### q-owner — Does phase-01 own the cache write?",
    "",
    "- p1 — phase-01 writes it — abandons: a smaller first phase",
    "- p2 — phase-02 writes it — abandons: an early cache",
    "",
    "Recommendation: p1 — the schema phase already touches the cache.",
    "",
    "## Arbitrated questions",
    "",
    "### q-keep — How many entries are kept?",
    "",
    "- keep-10 — Ten — abandons: older entries",
    "- keep-20 — Twenty — abandons: disk space",
    "",
    "Recommendation: keep-10 — ten covers a week.",
    "",
    "Decision: keep-20 — by operator (Ada Lovelace), 2026-10-20",
    "Why: two weeks are asked for. Advocate: ten is enough. Principles: none. Reversibility: cheap. Revised: none. Phase: phase-01.",
    "",
    "## Decision log",
    "",
    "- 2026-10-20 q-keep decided keep-20 — operator (Ada Lovelace)",
    "",
    "---",
    "",
    "",
  ].join("\n");

  function withQuestions(md: string): string {
    const at = md.indexOf("## phase-01");
    return `${md.slice(0, at)}${QUESTIONS}${md.slice(at)}`;
  }

  it("extracts the same plan, required commands included", () => {
    const plain = makePlan({ requiredCommands: "- pnpm test" });
    const questioned = withQuestions(plain);
    expect(questioned).toContain("### q-keep");
    const before = extractPlanDeterministic(plain);
    const after = extractPlanDeterministic(questioned);
    expect(Either.isRight(after)).toBe(true);
    expect(after).toEqual(before);
  });

  it("adds no structure error", () => {
    expect(collectPlanStructureErrors(withQuestions(makePlan()))).toEqual([]);
  });
});

describe("an `**Assignment reason:**` line under the effort line", () => {
  const plan = (reason?: string) =>
    makePlan({
      phases: [
        makePhase(),
        makePhase({
          id: "phase-02",
          title: "Beta",
          model: "claude-haiku-5-5",
          effort: "low",
          ...(reason === undefined ? {} : { reason }),
        }),
      ],
    });

  it("parses with no error to the same projection as the plan without it", () => {
    const reasoned = plan("Renames files only, so the lightest model is enough.");
    const plain = plan();
    expect(reasoned).toContain("\n**Assignment reason:** ");
    expect(collectPlanStructureErrors(reasoned)).toEqual([]);
    const withReason = extractPlanDeterministic(reasoned);
    expect(Either.isRight(withReason)).toBe(true);
    expect(withReason).toEqual(extractPlanDeterministic(plain));
    if (Either.isRight(withReason)) {
      expect(withReason.right.phases[1]).toMatchObject({
        model: "claude-haiku-5-5",
        effort: "low",
      });
    }
  });
});

/** The phases a plan extracts to on the deterministic path. */
function extractedPhases(md: string) {
  const result = extractPlanDeterministic(md);
  if (Either.isLeft(result)) throw new Error(`plan does not extract: ${result.left.message}`);
  return result.right.phases;
}

describe("mode and oracle, read from the header lines", () => {
  const ids = ["phase-01", "phase-02", "phase-03", "phase-04", "phase-05", "phase-06"];
  const plan = (headers: Readonly<Record<string, readonly string[]>>) =>
    makePlan({ phases: ids.map((id) => makePhase({ id, header: headers[id] ?? [] })) });

  it("extracts the mode: phase-03 interactive, the other five headless", () => {
    const extracted = extractedPhases(plan({ "phase-03": ["**Mode:** interactive"] }));
    expect(extracted.map((p) => p.mode)).toEqual([
      "headless",
      "headless",
      "interactive",
      "headless",
      "headless",
      "headless",
    ]);
    expect(extracted.every((p) => p.oracle === null)).toBe(true);
  });

  it("puts mode and oracle directly after optionalFilesToEdit", () => {
    const [first] = extractedPhases(plan({}));
    expect(Object.keys(first!).slice(-4)).toEqual([
      "optionalFilesToEdit",
      "mode",
      "oracle",
      "commit",
    ]);
  });

  it("defaults an oracle phase to the next phase, files in declaration order", () => {
    const extracted = extractedPhases(
      plan({
        "phase-02": [
          "**Oracle phase:** yes",
          "**Oracle files:** `tests/z.test.ts`, `tests/a.test.ts`",
        ],
      }),
    );
    expect(extracted[1]!.oracle).toEqual({
      dischargedBy: "phase-03",
      files: ["tests/z.test.ts", "tests/a.test.ts"],
    });
    expect(extracted[1]!.mode).toBe("headless");
  });

  it("keeps an explicit discharging phase", () => {
    const extracted = extractedPhases(
      plan({
        "phase-02": [
          "**Oracle phase:** discharged by phase-05",
          "**Oracle files:** tests/b.test.ts, `tests/a.test.ts`",
        ],
      }),
    );
    expect(extracted[1]!.oracle).toEqual({
      dischargedBy: "phase-05",
      files: ["tests/b.test.ts", "tests/a.test.ts"],
    });
  });

  it("reads a malformed or unresolvable declaration as headless with no oracle, and still extracts", () => {
    const md = plan({
      "phase-01": ["**Mode:** review"],
      "phase-02": ["**Oracle phase:** maybe", "**Oracle files:** `tests/a.test.ts`"],
      "phase-03": ["**Oracle phase:** yes"],
      "phase-06": ["**Oracle phase:** yes", "**Oracle files:** `tests/a.test.ts`"],
    });
    expect(collectPlanStructureErrors(md)).toEqual([]);
    const extracted = extractedPhases(md);
    expect(extracted.map((p) => [p.mode, p.oracle])).toEqual(ids.map(() => ["headless", null]));
  });
});
