import { describe, expect, it } from "vitest";
import {
  buildShortPrBody,
  PR_BODY_MAX_BYTES,
  type ShortPrBodyInput,
} from "../../../src/domain/publish/prBody.js";
import { renderPrFooter } from "../../../src/domain/publish/prFooter.js";
import type {
  GlobalFileEntry,
  GlobalFileReconciliation,
} from "../../../src/domain/reconciliation/global.js";
import {
  gatherReviewNotes,
  renderReviewNotes,
  type ReviewNoteGroup,
} from "../../../src/domain/review/reviewNotes.js";
import type { ComplianceReview } from "../../../src/schemas/complianceReview.js";
import {
  CODE_REVIEW_ESCAPES,
  CODE_REVIEW_LENSES,
  type CodeReviewFinding,
} from "../../../src/schemas/codeReview.js";

function entry(
  path: string,
  overrides: Partial<GlobalFileEntry> & Pick<GlobalFileEntry, "status">,
): GlobalFileEntry {
  return {
    path,
    plannedInPhases: [],
    touchedInPhases: [],
    optionalInPhases: [],
    reviewCorrectedInPhases: [],
    expectedActions: [],
    actualActions: [],
    planned: false,
    unplanned: false,
    missing: false,
    extraTouch: false,
    attention: "review",
    ...overrides,
  };
}

function unplanned(path: string, phaseIds: readonly string[]): GlobalFileEntry {
  return entry(path, { status: "unplanned", unplanned: true, touchedInPhases: phaseIds });
}

function missing(path: string, phaseIds: readonly string[]): GlobalFileEntry {
  return entry(path, { status: "missing", missing: true, plannedInPhases: phaseIds });
}

function makeGlobal(
  unplannedEntries: readonly GlobalFileEntry[],
  missingEntries: readonly GlobalFileEntry[],
): GlobalFileReconciliation {
  const files = [...unplannedEntries, ...missingEntries];
  return { files, unplanned: unplannedEntries, missing: missingEntries, attentionPoints: files };
}

const review: ComplianceReview = {
  verdict: "conformant-with-deviations",
  summary: "COMPLIANCE-SUMMARY-TEXT",
  perPhase: [
    { phaseId: "phase-01", verdict: "conformant", findings: [] },
    {
      phaseId: "phase-02",
      verdict: "conformant-with-deviations",
      findings: [{ dimension: "files", severity: "deviation", message: "FINDING-MESSAGE-TEXT" }],
    },
    { phaseId: "phase-03", verdict: "conformant", findings: [] },
  ],
  attentionPoints: [
    "Check that `greet --color` falls back to plain text when NO_COLOR is set.",
    "The greeting width is hard-coded to 80 columns.",
  ],
  pointers: ["POINTER-TEXT"],
};

const noteGroups = gatherReviewNotes([
  {
    phaseId: "phase-01",
    notes: [{ owner: "docs team", note: "The greet help text names a flag that was renamed." }],
  },
  {
    phaseId: "phase-02",
    notes: [
      { owner: "docs team", note: "The greet help text names a flag that was renamed." },
      { owner: "design", note: "Pick the accent color for the greeting." },
    ],
  },
]);

const base: ShortPrBodyInput = {
  qualifiedName: "acme.greet-cli",
  shortName: "greet-cli",
  sourceSpecOutcome: "`docs/specs/2610091100-greet-cli.md` — completed on this branch (abc1234)\n",
  gateProfileId: "standard",
  phases: [
    { phaseId: "phase-01", title: "The greet command", status: "passed", stop: null },
    { phaseId: "phase-02", title: "Colored output", status: "passed", stop: null },
    { phaseId: "phase-03", title: "Plain renderer tests", status: "passed", stop: null },
  ],
  verifiedSurfaces: ["local", "structural"],
  compliance: { kind: "reviewed", review },
  codeReview: { kind: "not-reviewed" },
  global: makeGlobal(
    [
      unplanned("src/render/colors.ts", ["phase-02"]),
      unplanned("src/render/index.ts", ["phase-02"]),
    ],
    [missing("tests/render/plain.test.ts", ["phase-03"])],
  ),
  phaseHandoffs: [
    { phaseId: "phase-01", handoffMd: "## What was delivered\n\nThe greet command." },
    {
      phaseId: "phase-02",
      handoffMd: "## What the next phase needs to know\n\nsrc/render/index.ts re-exports colors.",
    },
    { phaseId: "phase-03", handoffMd: "## What was delivered\n\nNothing." },
  ],
  reviewNoteGroups: noteGroups,
  runFolder: { path: "/home/dev/.phax/runs/acme.greet-cli", homeDir: "/home/dev" },
  records: "not-configured",
  footer: {
    version: "9.8.7",
    plan: { kind: "path", path: "docs/plans/2610101200-greet-cli-plan.md" },
    spec: { kind: "none" },
    agents: [{ provider: "claude", model: "claude-made-up-1", effort: "medium", phases: 3 }],
    qualifiedName: "acme.greet-cli",
  },
};

const FOOTER = renderPrFooter(base.footer);

function lineOf(text: string, id: string): string {
  return text.split("\n").find((l) => l.startsWith(`- \`${id}\``)) ?? "";
}

function build(overrides: Partial<ShortPrBodyInput> = {}): string {
  const result = buildShortPrBody({ ...base, ...overrides });
  expect(result.shortened).toBe(false);
  return result.body;
}

function section(body: string, heading: string): string {
  const start = body.indexOf(`${heading}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = body.indexOf("\n## ", start + heading.length);
  return body.slice(start, next === -1 ? undefined : next);
}

describe("buildShortPrBody — shape", () => {
  it("orders summary, phases, needs-your-review, review notes and full detail", () => {
    const body = build();
    const phases = body.indexOf("## Phases");
    const needs = body.indexOf("## Needs your review");
    const notes = body.indexOf("## Review notes");
    const full = body.indexOf("## Full detail");
    expect(body.startsWith("**Run** ")).toBe(true);
    expect(0).toBeLessThan(phases);
    expect(phases).toBeLessThan(needs);
    expect(needs).toBeLessThan(notes);
    expect(notes).toBeLessThan(full);
  });

  it("holds none of the review handoff's detail", () => {
    const body = build();
    expect(body.split("\n").some((line) => line.startsWith("# "))).toBe(false);
    for (const absent of [
      "## Phase details",
      "File reconciliation",
      "## Plan compliance review",
      "Global File Reconciliation",
      "re-exports colors",
      "The greet command.",
      "COMPLIANCE-SUMMARY-TEXT",
      "FINDING-MESSAGE-TEXT",
      "POINTER-TEXT",
      "shortened",
    ]) {
      expect(body).not.toContain(absent);
    }
  });

  it("writes the summary one fact per line with hard breaks", () => {
    const body = build();
    const summary = body.slice(0, body.indexOf("\n\n## Phases"));
    expect(summary).toBe(
      [
        "**Run** `acme.greet-cli` · **Plan** `docs/plans/2610101200-greet-cli-plan.md` · **Gate profile** `standard`\\",
        "**Spec** `docs/specs/2610091100-greet-cli.md` — completed on this branch (abc1234)\\",
        "**Phases** 3/3 passed · **Verified surfaces** local, structural\\",
        "**Compliance** conformant-with-deviations",
      ].join("\n"),
    );
  });

  it("writes loose plan, no spec line, no gate profile and no surface when absent", () => {
    const body = build({
      footer: { ...base.footer, plan: { kind: "unrecorded" } },
      sourceSpecOutcome: undefined,
      gateProfileId: undefined,
      verifiedSurfaces: [],
    });
    expect(body).toContain("**Plan** loose plan · **Gate profile** (none)");
    expect(body).not.toContain("**Spec**");
    expect(body).toContain("**Verified surfaces** none");
  });

  it("writes one line per phase with its verdict and deviation counts", () => {
    const phases = section(build(), "## Phases");
    expect(phases).toContain("- `phase-01` The greet command — conformant · no deviation");
    expect(phases).toContain(
      "- `phase-02` Colored output — conformant-with-deviations · 2 deviations, 1 unexplained",
    );
    expect(phases).toContain(
      "- `phase-03` Plain renderer tests — conformant · 1 deviation, 1 unexplained",
    );
  });

  it("suffixes a stopped phase's line and leaves the others as they are", () => {
    const ada = { name: "Ada Example", email: "ada@example.com" };
    const summary = {
      corrections: ["a", "b"],
      guards: ["g1", "g2"],
      noGuard: [],
      correctedSection: "",
      guardsSection: "",
    };
    const plain = build();
    const body = build({
      phases: [
        base.phases[0]!,
        {
          ...base.phases[1]!,
          stop: {
            phaseId: "phase-02",
            cause: "held",
            outcome: "corrected",
            closedBy: ada,
            summary,
          },
        },
        {
          ...base.phases[2]!,
          stop: {
            phaseId: "phase-03",
            cause: "held",
            outcome: "unchanged",
            closedBy: ada,
            summary,
          },
        },
      ],
    });
    expect(lineOf(body, "phase-01")).toBe(lineOf(plain, "phase-01"));
    expect(lineOf(body, "phase-02")).toBe(
      `${lineOf(plain, "phase-02")} · held, corrected by Ada Example (2 guards)`,
    );
    expect(lineOf(body, "phase-03")).toBe(
      `${lineOf(plain, "phase-03")} · held, reviewed without change by Ada Example`,
    );
  });

  it("writes a skipped phase without verdict or counts, and does not count it passed", () => {
    const body = build({
      phases: [
        base.phases[0]!,
        base.phases[1]!,
        { phaseId: "phase-03", title: "Plain renderer tests", status: "skipped", stop: null },
      ],
    });
    expect(body).toContain("- `phase-03` Plain renderer tests — skipped\n");
    expect(body).toContain("**Phases** 2/3 passed");
  });

  it("lists only the unexplained deviations", () => {
    const needs = section(build(), "## Needs your review");
    expect(needs).toContain("- `src/render/colors.ts` — unplanned, touched in phase-02");
    expect(needs).toContain("- `tests/render/plain.test.ts` — missing, planned in phase-03");
    expect(needs).not.toContain("src/render/index.ts");
  });

  it("writes None. when no deviation is unexplained", () => {
    const needs = section(build({ global: makeGlobal([], []) }), "## Needs your review");
    expect(needs).toContain("### Unexplained deviations\n\nNone.");
  });

  it("lists the attention points verbatim, before the deviations", () => {
    const needs = section(build(), "## Needs your review");
    expect(needs).toContain(
      "### Compliance attention points\n\n" +
        "- Check that `greet --color` falls back to plain text when NO_COLOR is set.\n" +
        "- The greeting width is hard-coded to 80 columns.",
    );
    expect(needs.indexOf("### Compliance attention points")).toBeLessThan(
      needs.indexOf("### Unexplained deviations"),
    );
  });

  it("keeps each attention point on its own line", () => {
    const needs = section(
      build({
        compliance: {
          kind: "reviewed",
          review: {
            ...review,
            attentionPoints: ["Check the fallback\n\n## when NO_COLOR is set."],
          },
        },
      }),
      "## Needs your review",
    );
    expect(needs).toContain(
      "### Compliance attention points\n\n- Check the fallback ## when NO_COLOR is set.",
    );
  });

  it("writes None. when the review has no attention point", () => {
    const needs = section(
      build({ compliance: { kind: "reviewed", review: { ...review, attentionPoints: [] } } }),
      "## Needs your review",
    );
    expect(needs).toContain("### Compliance attention points\n\nNone.");
  });

  it("writes not reviewed everywhere and no attention points without a review", () => {
    const body = build({ compliance: { kind: "not-reviewed" } });
    expect(body).toContain("**Compliance** not reviewed");
    expect(body).toContain("- `phase-01` The greet command — not reviewed · no deviation");
    expect(body).toContain("- `phase-02` Colored output — not reviewed · 2 deviations");
    expect(body).not.toContain("### Compliance attention points");
  });

  it("writes not reviewed for a phase the review does not name", () => {
    const body = build({
      compliance: { kind: "reviewed", review: { ...review, perPhase: [] } },
    });
    expect(body).toContain("- `phase-01` The greet command — not reviewed · no deviation");
  });

  it("renders the review notes exactly as the review handoff does", () => {
    const notes = section(build(), "## Review notes");
    expect(notes.trimEnd()).toBe(renderReviewNotes(noteGroups));
    expect(notes.match(/names a flag that was renamed/g)).toHaveLength(1);
    expect(notes).toContain("(phase-01, phase-02)");
  });

  it("has no review notes section without notes", () => {
    expect(build({ reviewNoteGroups: [] })).not.toContain("## Review notes");
  });

  it("points to the review handoff in the run folder, home written as ~", () => {
    const body = build();
    expect(body).toContain("`~/.phax/runs/acme.greet-cli/review-handoff.md`");
    expect(body).toContain("`phax review-handoff greet-cli`");
    expect(body).not.toContain("/home/dev");
    expect(section(body, "## Full detail")).not.toMatch(/branch/i);
    expect(build({ sourceSpecOutcome: undefined })).not.toMatch(/branch/i);
  });

  it("keeps a run folder outside the home directory as it is", () => {
    const body = build({
      runFolder: { path: "/srv/phax/runs/acme.greet-cli", homeDir: "/home/dev" },
    });
    expect(body).toContain("`/srv/phax/runs/acme.greet-cli/review-handoff.md`");
  });

  it("does not rewrite a sibling of the home directory", () => {
    const body = build({
      runFolder: { path: "/home/developer/runs/acme.greet-cli", homeDir: "/home/dev" },
    });
    expect(body).toContain("`/home/developer/runs/acme.greet-cli/review-handoff.md`");
  });

  it("names phax records explain only when records are configured", () => {
    expect(build()).not.toContain("phax records explain");
    const body = build({ records: "configured" });
    expect(section(body, "## Full detail")).toContain("`phax records explain <commit>`");
  });
});

const SHORTENED_NOTE =
  "\n\n---\n\n*This description was shortened to fit GitHub's limit. " +
  "The review handoff named under Full detail lists every entry.*";

function manyDeviations(count: number): GlobalFileEntry[] {
  return Array.from({ length: count }, (_, i) =>
    unplanned(`src/generated/module-${String(i).padStart(4, "0")}/index.ts`, ["phase-02"]),
  );
}

function manyNotes(count: number): ReadonlyArray<ReviewNoteGroup> {
  return gatherReviewNotes([
    {
      phaseId: "phase-01",
      notes: Array.from({ length: count }, (_, i) => ({
        owner: i % 2 === 0 ? "docs team" : "design",
        note: `Review the generated greeting variant number ${i} for tone and length.`,
      })),
    },
  ]);
}

describe("buildShortPrBody — size cap", () => {
  it("cuts unexplained deviations first and keeps attention points and notes whole", () => {
    const attentionPoints = Array.from(
      { length: 30 },
      (_, i) => `Attention point ${i}: check the greeting edge case.`,
    );
    const groups = gatherReviewNotes([
      {
        phaseId: "phase-01",
        notes: Array.from({ length: 5 }, (_, i) => ({ owner: "docs team", note: `Note ${i}.` })),
      },
    ]);
    const started = performance.now();
    const { body, shortened } = buildShortPrBody({
      ...base,
      compliance: { kind: "reviewed", review: { ...review, attentionPoints } },
      global: makeGlobal(manyDeviations(2000), []),
      reviewNoteGroups: groups,
    });
    expect(performance.now() - started).toBeLessThan(2000);

    expect(shortened).toBe(true);
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(PR_BODY_MAX_BYTES);
    expect(body.endsWith(`${SHORTENED_NOTE}\n\n${FOOTER}`)).toBe(true);

    const kept = body.match(/- `src\/generated\/module-\d{4}\/index\.ts`/g) ?? [];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(2000);
    expect(body).toContain(`- …and ${2000 - kept.length} more unexplained deviations`);
    // Keeping one more deviation would not fit.
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(PR_BODY_MAX_BYTES - 200);

    for (const point of attentionPoints) expect(body).toContain(`- ${point}`);
    expect(body).not.toContain("more attention point");
    expect(section(body, "## Review notes").trimEnd()).toBe(renderReviewNotes(groups));
    expect(body).not.toContain("more review note");
    expect(body).toContain("## Full detail");
  });

  it("cuts attention points once every deviation is cut", () => {
    const attentionPoints = Array.from(
      { length: 50 },
      (_, i) => `Attention point ${i}: ${"x".repeat(80)}`,
    );
    const { body, shortened } = buildShortPrBody({
      ...base,
      compliance: { kind: "reviewed", review: { ...review, attentionPoints } },
      global: makeGlobal(manyDeviations(10), []),
      maxBytes: 4000,
    });
    expect(shortened).toBe(true);
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(4000);
    expect(body).toContain("### Unexplained deviations\n\n- …and 10 more unexplained deviations");
    expect(body).not.toContain("src/generated/");
    expect(body).toContain("- Attention point 0:");
    expect(body).toMatch(/- …and \d+ more attention points/);
    expect(section(body, "## Review notes").trimEnd()).toBe(renderReviewNotes(noteGroups));
  });

  it("cuts review notes last, keeping the heading, the intro and the first notes", () => {
    const groups = manyNotes(2000);
    const { body, shortened } = buildShortPrBody({
      ...base,
      global: makeGlobal(manyDeviations(10), []),
      reviewNoteGroups: groups,
    });
    expect(shortened).toBe(true);
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(PR_BODY_MAX_BYTES);

    const needs = section(body, "## Needs your review");
    expect(needs).toContain("### Unexplained deviations\n\n- …and 10 more unexplained deviations");
    expect(needs).toContain("### Compliance attention points\n\n- …and 2 more attention points");
    expect(needs).not.toContain("src/generated/");
    expect(needs).not.toContain("NO_COLOR");

    const notes = section(body, "## Review notes");
    expect(notes).toContain(
      "## Review notes\n\nNotes the gate steps left for a person. None was sent to the agent.",
    );
    expect(notes).toContain("- Review the generated greeting variant number 0 for tone");
    expect(notes).toMatch(/- …and \d+ more review notes\n*$/);
    expect(body.indexOf("## Review notes")).toBeLessThan(body.indexOf("## Full detail"));
    expect(body.endsWith(`${SHORTENED_NOTE}\n\n${FOOTER}`)).toBe(true);
  });

  it("keeps the notes heading and intro when every note is cut", () => {
    const input: ShortPrBodyInput = {
      ...base,
      compliance: { kind: "not-reviewed" },
      global: makeGlobal([], []),
      reviewNoteGroups: manyNotes(4),
    };
    const fullyCut = buildShortPrBody({ ...input, maxBytes: 1 }).body;
    const { body } = buildShortPrBody({
      ...input,
      maxBytes: Buffer.byteLength(fullyCut, "utf8") + 20,
    });
    expect(section(body, "## Review notes")).toContain(
      "Notes the gate steps left for a person. None was sent to the agent.\n\n- …and 4 more review notes",
    );
    expect(body).not.toContain("### docs team");
  });

  it("returns the fully cut body when the never-cut sections alone exceed the cap", () => {
    const { body, shortened } = buildShortPrBody({ ...base, maxBytes: 100 });
    expect(shortened).toBe(true);
    expect(body).toContain("- …and 2 more unexplained deviations");
    expect(body).toContain("- …and 2 more attention points");
    expect(body).toContain("- …and 2 more review notes");
    expect(body).toContain("## Phases");
    expect(body).toContain("## Full detail");
    expect(body.endsWith(`${SHORTENED_NOTE}\n\n${FOOTER}`)).toBe(true);
  });

  it("writes the singular count line for one cut entry", () => {
    const input: ShortPrBodyInput = {
      ...base,
      global: makeGlobal([unplanned(`src/${"long/".repeat(60)}last.ts`, ["phase-02"])], []),
    };
    const full = buildShortPrBody(input).body;
    const { body } = buildShortPrBody({
      ...input,
      maxBytes: Buffer.byteLength(full, "utf8") - 1,
    });
    expect(body).toContain("### Unexplained deviations\n\n- …and 1 more unexplained deviation\n");
  });
});

function finding(overrides: Partial<CodeReviewFinding> = {}): CodeReviewFinding {
  return {
    severity: "concern",
    file: "src/greet.ts",
    line: 12,
    message: "The greeting ignores NO_COLOR.",
    lens: CODE_REVIEW_LENSES[0],
    escape: CODE_REVIEW_ESCAPES[0],
    criterion: null,
    suggestion: "Honour NO_COLOR.",
    ...overrides,
  };
}

function reviewed(...findings: CodeReviewFinding[]): ShortPrBodyInput["codeReview"] {
  return { kind: "reviewed", review: { findings } };
}

describe("buildShortPrBody — code review findings", () => {
  it("lists one line per finding, between the attention points and the deviations", () => {
    const body = build({
      codeReview: reviewed(
        finding({ severity: "bug", file: "src/a.ts", line: 3, message: "First." }),
        finding({ severity: "info", file: "docs/b.md", line: 40, message: "Second." }),
      ),
    });
    const needs = section(body, "## Needs your review");
    expect(needs).toContain(
      "### Code review findings\n\n- **bug** `src/a.ts:3` — First.\n- **info** `docs/b.md:40` — Second.",
    );
    expect(needs.indexOf("### Compliance attention points")).toBeLessThan(
      needs.indexOf("### Code review findings"),
    );
    expect(needs.indexOf("### Code review findings")).toBeLessThan(
      needs.indexOf("### Unexplained deviations"),
    );
  });

  it("leaves the heading out without a code review and writes None. for no finding", () => {
    expect(build()).not.toContain("### Code review findings");
    expect(build({ codeReview: reviewed() })).toContain("### Code review findings\n\nNone.");
  });

  it("keeps a finding on one line with an intact code span", () => {
    const body = build({
      codeReview: reviewed(
        finding({ file: "src/we`ird.ts", message: "One\n\n## fake heading" }),
        finding({ file: "a\nb.ts", line: 2 }),
      ),
    });
    expect(body).toContain("- **concern** `` src/we`ird.ts:12 `` — One ## fake heading");
    expect(body).toContain("- **concern** `a b.ts:2` —");
  });

  it("cuts findings after the attention points and before the review notes", () => {
    const findings = Array.from({ length: 300 }, (_, i) =>
      finding({ line: i + 1, message: `Finding number ${i}: ${"x".repeat(60)}` }),
    );
    const input: ShortPrBodyInput = {
      ...base,
      codeReview: reviewed(...findings),
      global: makeGlobal(manyDeviations(10), []),
      maxBytes: 8000,
    };
    const { body, shortened } = buildShortPrBody(input);
    expect(shortened).toBe(true);
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(8000);
    const needs = section(body, "## Needs your review");
    expect(needs).toContain("### Unexplained deviations\n\n- …and 10 more unexplained deviations");
    expect(needs).toContain("### Compliance attention points\n\n- …and 2 more attention points");
    expect(needs).toContain("Finding number 0:");
    const cut = needs.match(/- …and (\d+) more code review findings/);
    expect(cut).not.toBeNull();
    const kept = needs.match(/- \*\*concern\*\* /g) ?? [];
    expect(kept.length + Number(cut![1])).toBe(300);
    expect(section(body, "## Review notes").trimEnd()).toBe(renderReviewNotes(noteGroups));
  });

  it("cuts review notes only when no finding fits", () => {
    const { body } = buildShortPrBody({
      ...base,
      codeReview: reviewed(finding(), finding({ line: 2 })),
      global: makeGlobal(manyDeviations(10), []),
      reviewNoteGroups: manyNotes(2000),
    });
    expect(body).toContain("### Code review findings\n\n- …and 2 more code review findings");
    expect(body).toContain("- …and 2 more attention points");
    expect(body).toMatch(/- …and \d+ more review notes/);
  });

  it("writes the singular noun for one cut finding", () => {
    const input: ShortPrBodyInput = {
      ...base,
      compliance: { kind: "reviewed", review: { ...review, attentionPoints: [] } },
      global: makeGlobal([], []),
      codeReview: reviewed(finding({ message: "y".repeat(3000) })),
    };
    const full = buildShortPrBody(input).body;
    const { body } = buildShortPrBody({
      ...input,
      maxBytes: Buffer.byteLength(full, "utf8") - 1,
    });
    expect(body).toContain("- …and 1 more code review finding\n");
  });
});

describe("buildShortPrBody — footer", () => {
  it("ends the body with the footer, after Full detail", () => {
    const body = build();
    expect(body.endsWith(`\n\n${FOOTER}`)).toBe(true);
    expect(body.indexOf("## Full detail")).toBeLessThan(body.indexOf(FOOTER));
  });

  it("keeps the footer whole after the shortened note, at every cut stage", () => {
    for (const maxBytes of [100, 4000, PR_BODY_MAX_BYTES]) {
      const { body, shortened } = buildShortPrBody({
        ...base,
        global: makeGlobal(manyDeviations(2000), []),
        maxBytes,
      });
      expect(shortened).toBe(true);
      expect(body.endsWith(`${SHORTENED_NOTE}\n\n${FOOTER}`)).toBe(true);
    }
  });

  it("shortens a body pushed over the cap only by the footer", () => {
    const withoutFooter = buildShortPrBody(base).body.slice(0, -`\n\n${FOOTER}`.length);
    const { body, shortened } = buildShortPrBody({
      ...base,
      maxBytes: Buffer.byteLength(withoutFooter, "utf8") + 1,
    });
    expect(shortened).toBe(true);
    expect(body.endsWith(FOOTER)).toBe(true);
  });

  it("names the plan in the summary as the footer does", () => {
    const plan = {
      kind: "permalink",
      path: "docs/plans/archive/2610101200-greet-cli-plan.md",
      url: "https://github.com/example/repo/blob/abc/docs/plans/archive/2610101200-greet-cli-plan.md",
    } as const;
    const body = build({ footer: { ...base.footer, plan } });
    const link = `[\`${plan.path}\`](${plan.url})`;
    expect(body.split("\n")[0]).toContain(`**Plan** ${link} · **Gate profile**`);
    expect(body).toContain(`\n**Plan** ${link}\\\n`);
  });
});
