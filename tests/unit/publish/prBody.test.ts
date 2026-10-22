import { describe, expect, it } from "vitest";
import {
  buildShortPrBody,
  PR_BODY_MAX_BYTES,
  type ShortPrBodyInput,
} from "../../../src/domain/publish/prBody.js";
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
  plan: { kind: "path", path: "docs/plans/2610101200-greet-cli-plan.md" },
  sourceSpecOutcome: "`docs/specs/2610091100-greet-cli.md` — completed on this branch (abc1234)\n",
  gateProfileId: "standard",
  phases: [
    { phaseId: "phase-01", title: "The greet command", status: "passed" },
    { phaseId: "phase-02", title: "Colored output", status: "passed" },
    { phaseId: "phase-03", title: "Plain renderer tests", status: "passed" },
  ],
  verifiedSurfaces: ["local", "structural"],
  compliance: { kind: "reviewed", review },
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
};

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
      plan: { kind: "loose" },
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

  it("writes a skipped phase without verdict or counts, and does not count it passed", () => {
    const body = build({
      phases: [
        base.phases[0]!,
        base.phases[1]!,
        { phaseId: "phase-03", title: "Plain renderer tests", status: "skipped" },
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
    expect(body.endsWith(SHORTENED_NOTE)).toBe(true);

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
    expect(body.endsWith(SHORTENED_NOTE)).toBe(true);
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
    expect(body.endsWith(SHORTENED_NOTE)).toBe(true);
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
