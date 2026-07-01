import { describe, it, expect } from "vitest";
import { Either } from "effect";
import { extractPlanDeterministic } from "../../src/domain/plan/parsePlanMarkdown.js";

function makePhase(
  overrides: {
    id?: string;
    anchor?: string;
    title?: string;
    model?: string;
    effort?: string;
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
    `**Recommended effort:** ${effort}`,
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
});
