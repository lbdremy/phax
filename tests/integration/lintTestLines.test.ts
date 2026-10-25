// Acceptance criteria carry a `then` key (given/when/then) — data, never awaited.
/* eslint-disable unicorn/no-thenable */
// Oracles for lint's test-line rules (spec test-strategy §5.7–§5.10, §5.12),
// written before their code and frozen. Every case is an expected failure
// until phase-04 removes the markers and writes the rules.
import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { lintPlan, type LintReport } from "../../src/app/lintPlan.js";
import { hasLintErrors } from "../../src/domain/plan/lint.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { encodeSpecDocumentFile, type SpecDocument } from "../../src/schemas/specDocument.js";

const REPO_ROOT = "/repo";
const PLAN_REL = "docs/plans/2610240900-invoice-export-plan.md";
const PLAN_PATH = `${REPO_ROOT}/${PLAN_REL}`;
const SPEC_REL = "docs/specs/2610231100-invoice-export.md";
const SPEC_JSON_REL = "docs/specs/2610231100-invoice-export.json";
const ARCHIVE_SPEC_REL = "docs/specs/archive/2610231100-invoice-export.md";
const ARCHIVE_SPEC_JSON_REL = "docs/specs/archive/2610231100-invoice-export.json";

const config = {
  stateRoot: "/home/user/.phax",
  namespace: "test-project",
  extractPlanModel: "claude-sonnet-4-6",
  extractPlanEffort: "medium",
  raw: {
    version: 1,
    name: "test-project",
    state: { root: "/home/user/.phax" },
    gateProfiles: {
      standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
    },
  },
  security: {
    profile: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only", allowDomains: [] },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: ["pnpm"],
  },
  repoRoot: REPO_ROOT,
  maxFixAttempts: 1,
  fileReconciliationMode: "report_only",
  publish: {
    auto: false,
    remote: "origin",
    provider: "github",
    pushBranch: true,
    createPullRequest: true,
  },
  complianceReview: { enabled: false, model: "claude-sonnet-4-6", effort: "medium" },
  // An oracles provider, so an oracle pair raises no `oracles` error.
  oracles: { command: "node made-up-oracles.mjs" },
} as unknown as ResolvedConfig;

interface PhaseSpec {
  readonly oracle?: boolean;
  readonly create?: string;
  /** The `### Test strategy` entries, written by hand in the line format. */
  readonly lines: readonly string[];
}

/** A Draft plan.md whose phases carry the policy default model and effort. */
function planMd(phases: readonly PhaseSpec[]): string {
  const blocks = phases.map((phase, index) => {
    const id = `phase-0${index + 1}`;
    const create = phase.create ?? `src/export/part${index + 1}.ts`;
    const oracleHeader =
      phase.oracle === true ? `\n**Oracle phase:** yes\n**Oracle files:** ${create}` : "";
    return `## ${id} — Phase ${index + 1} {#${id}-part}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium${oracleHeader}

### Planned files to create

- ${create}

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Test strategy

${phase.lines.join("\n")}

### Commit subject

feat(export): part ${index + 1}

### Commit body

Does part ${index + 1}.
`;
  });
  return `---
status: Draft
source-spec: ${SPEC_REL}
completes-spec: true
---
# Invoice export

## Required commands

- (none)

${blocks.join("\n")}`;
}

const line = (guarantee: string, loop: "in-phase" | "oracle", criterion?: string): string =>
  `- ${guarantee} — small · example · the findings · ${loop}${criterion === undefined ? "" : ` · ${criterion}`}`;

/** A made-up spec document with these acceptance criteria. */
function specDocument(criteria: readonly string[]): SpecDocument {
  return {
    kind: "spec",
    title: "Invoice export",
    ground: [],
    context: "Invoices are exported by hand.",
    problem: "Export is manual.",
    productGoal: {
      statement: "Export invoices with one command.",
      guidingRule: "One command, one file.",
    },
    terminology: [],
    requirements: [
      {
        id: "R-export",
        title: "Export",
        pattern: "event",
        statement: "WHEN an export is requested THE system SHALL write a file.",
      },
    ],
    surface: [],
    nonGoals: [],
    acceptanceCriteria: criteria.map((id) => ({
      id,
      name: `Criterion ${id}`,
      given: "an invoice",
      when: "it is exported",
      then: "a file is written",
      refs: ["R-export"],
    })) as unknown as SpecDocument["acceptanceCriteria"],
    openQuestions: [],
    arbitratedQuestions: [],
    planningNote: { settled: [], open: [], constraints: [] },
    docsPage: { kind: "none", why: "an internal fixture" },
  };
}

const specJson = (criteria: readonly string[]): string =>
  JSON.stringify(
    encodeSpecDocumentFile(withSchemaUrl("spec-document", specDocument(criteria))),
    null,
    2,
  );

/** The spec, as the fake FileSystem holds it: a `.md`, with its sidecar when given. */
function specFiles(mdRel: string, jsonRel: string, sidecar: string | null): Record<string, string> {
  const files: Record<string, string> = { [`${REPO_ROOT}/${mdRel}`]: "# Invoice export\n" };
  if (sidecar !== null) files[`${REPO_ROOT}/${jsonRel}`] = sidecar;
  return files;
}

const liveSpec = (criteria: readonly string[]) =>
  specFiles(SPEC_REL, SPEC_JSON_REL, specJson(criteria));

function runLint(plan: string, files: Readonly<Record<string, string>>): Promise<LintReport> {
  const fakeFs = makeFakeFileSystem();
  fakeFs.impl.setFile(PLAN_PATH, plan);
  for (const [path, content] of Object.entries(files)) fakeFs.impl.setFile(path, content);
  const fakeShell = makeFakeShell();
  fakeShell.impl.setDefaultResponse({
    exitCode: 0,
    stdout: JSON.stringify({ findings: [] }),
    stderr: "",
  });
  return Effect.runPromise(
    lintPlan({
      planMdPath: PLAN_PATH,
      reportPath: PLAN_PATH,
      repoRelPath: PLAN_REL,
      config,
    }).pipe(Effect.provide(Layer.mergeAll(fakeFs.layer, fakeShell.layer))),
  );
}

const testsRows = (report: LintReport) => report.findings.filter((f) => f.check === "tests");
const row = (severity: "error" | "warning", phase: string | null, message: string) => ({
  severity,
  check: "tests",
  phase,
  message,
});

const unknown = (n: number, id: string) =>
  `test line ${n} names criterion "${id}", which invoice-export does not have`;
const misplaced = (n: number, phase: string) =>
  `test line ${n} is in the oracle loop, but ${phase} is not an oracle phase`;
const silent = (phase: string) =>
  `${phase} is an oracle phase, but none of its test lines is in the oracle loop`;
const uncovered = (id: string) => `criterion "${id}" of invoice-export is named by no test line`;

const ORACLE_FILE = "tests/unit/invoiceExport.test.ts";

describe("lint's test-line rules (oracles)", () => {
  describe("the oracle loop", () => {
    it("flags an oracle-loop line on a phase that discharges an oracle", async () => {
      const plan = planMd([
        {
          oracle: true,
          create: ORACLE_FILE,
          lines: [line("exports are listed", "oracle", "ac-a")],
        },
        {
          lines: [
            line("exports are written", "in-phase", "ac-b"),
            line("exports are sorted", "oracle"),
          ],
        },
      ]);
      const report = await runLint(plan, liveSpec(["ac-a", "ac-b"]));

      expect(testsRows(report)).toEqual([row("error", "phase-02", misplaced(2, "phase-02"))]);
      expect(hasLintErrors(report.findings)).toBe(true);
    });

    it("flags an oracle-loop line on an ordinary phase", async () => {
      const plan = planMd([{ lines: [line("exports are listed", "oracle", "ac-a")] }]);
      const report = await runLint(plan, liveSpec(["ac-a"]));

      expect(testsRows(report)).toEqual([row("error", "phase-01", misplaced(1, "phase-01"))]);
    });

    it("flags an oracle phase whose lines are all in-phase", async () => {
      const plan = planMd([
        {
          oracle: true,
          create: ORACLE_FILE,
          lines: [line("exports are listed", "in-phase", "ac-a")],
        },
        { lines: [line("exports are written", "in-phase", "ac-b")] },
      ]);
      const report = await runLint(plan, liveSpec(["ac-a", "ac-b"]));

      expect(testsRows(report)).toEqual([row("error", "phase-01", silent("phase-01"))]);
    });

    it("flags an oracle phase with no test line at all", async () => {
      const plan = planMd([
        { oracle: true, create: ORACLE_FILE, lines: ["- (none)"] },
        {
          lines: [
            line("exports are listed", "in-phase", "ac-a"),
            line("exports are written", "in-phase", "ac-b"),
          ],
        },
      ]);
      const report = await runLint(plan, liveSpec(["ac-a", "ac-b"]));

      expect(testsRows(report)).toEqual([row("error", "phase-01", silent("phase-01"))]);
    });
  });

  describe("the source spec's criteria", () => {
    const threeLines = {
      lines: [
        line("exports are listed", "in-phase", "ac-a"),
        line("exports are written", "in-phase", "ac-b"),
        line("exports are sorted", "in-phase", "ac-c"),
      ],
    };

    it("flags a criterion id the source spec does not have", async () => {
      const report = await runLint(planMd([threeLines]), liveSpec(["ac-a", "ac-b"]));

      expect(testsRows(report)).toEqual([row("error", "phase-01", unknown(3, "ac-c"))]);
      expect(hasLintErrors(report.findings)).toBe(true);
    });

    it("warns of a criterion that no test line names", async () => {
      const plan = planMd([{ lines: [line("exports are listed", "in-phase", "ac-a")] }]);
      const report = await runLint(plan, liveSpec(["ac-a", "ac-b"]));

      expect(testsRows(report)).toEqual([row("warning", null, uncovered("ac-b"))]);
      expect(hasLintErrors(report.findings)).toBe(false);
    });

    it("warns once of a hand-written spec with no JSON sidecar", async () => {
      const plan = planMd([{ lines: [line("exports are listed", "in-phase", "ac-a")] }]);
      const report = await runLint(plan, specFiles(SPEC_REL, SPEC_JSON_REL, null));

      expect(testsRows(report)).toEqual([
        row(
          "warning",
          null,
          `source spec ${SPEC_REL} has no JSON sidecar: no criterion id is checked`,
        ),
      ]);
    });

    it("falls back to the archived spec and its sidecar", async () => {
      const files = specFiles(ARCHIVE_SPEC_REL, ARCHIVE_SPEC_JSON_REL, specJson(["ac-a", "ac-b"]));
      const report = await runLint(planMd([threeLines]), files);

      expect(testsRows(report)).toEqual([row("error", "phase-01", unknown(3, "ac-c"))]);
    });

    it("warns once of a spec found at neither path", async () => {
      const plan = planMd([{ lines: [line("exports are listed", "in-phase", "ac-a")] }]);
      const report = await runLint(plan, {});

      expect(testsRows(report)).toEqual([
        row(
          "warning",
          null,
          `source spec ${SPEC_REL} is not found, here or under docs/specs/archive/: no criterion id is checked`,
        ),
      ]);
    });

    it("warns once of a sidecar that cannot be read", async () => {
      const plan = planMd([{ lines: [line("exports are listed", "in-phase", "ac-a")] }]);
      const report = await runLint(plan, specFiles(SPEC_REL, SPEC_JSON_REL, "this is not JSON"));

      expect(testsRows(report)).toEqual([
        {
          severity: "warning",
          check: "tests",
          phase: null,
          message: expect.stringMatching(
            /^source spec sidecar docs\/specs\/2610231100-invoice-export\.json cannot be read \(.+\): no criterion id is checked$/,
          ),
        },
      ]);
    });
  });

  describe("the order", () => {
    it("lists the oracle-loop error, the unknown id, then the uncovered warnings", async () => {
      const plan = planMd([{ lines: [line("exports are listed", "oracle", "ac-z")] }]);
      const report = await runLint(plan, liveSpec(["ac-a", "ac-b"]));

      expect(testsRows(report)).toEqual([
        row("error", "phase-01", misplaced(1, "phase-01")),
        row("error", "phase-01", unknown(1, "ac-z")),
        row("warning", null, uncovered("ac-a")),
        row("warning", null, uncovered("ac-b")),
      ]);
    });
  });
});
