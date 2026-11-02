import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { lintPlan, type LintReport } from "../../src/app/lintPlan.js";
import { hasLintErrors } from "../../src/domain/plan/lint.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import {
  acHeaderDischargedPlan,
  acHeaderNoFilesPlan,
  acHeaderOldPlan,
  acHeaderPlan,
  acLoopOldPlan,
  acLoopRulesPlan,
  DISCHARGED_BY_ROW,
  halfRewrittenOldHeaderPlan,
  halfRewrittenOldLoopPlan,
  MISPLACED_ROW,
  NO_FILES_ROW,
  NO_PROVIDER_ROW,
  OLD_FILES_ROW,
  OLD_LOOP_ROW,
  OLD_PHASE_ROW,
  SILENT_ROW,
} from "./acceptancePlanCases.js";

// Acceptance tests for the plan side of the acceptance-tests spec. Each one is
// expected to fail until the passing phase switches the header lines, the lint
// check and the loop messages to the acceptance names.

const REPO_ROOT = "/repo";
const PLAN_REL = "docs/plans/2611020900-publishing-plan.md";
const PLAN_PATH = `${REPO_ROOT}/${PLAN_REL}`;

const baseConfig = {
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
};

const withProvider = {
  ...baseConfig,
  acceptance: { command: "node scripts/acceptance-verdicts.mjs" },
} as unknown as ResolvedConfig;

const withoutProvider = baseConfig as unknown as ResolvedConfig;

function lint(plan: string, config: ResolvedConfig = withProvider): Promise<LintReport> {
  const fakeFs = makeFakeFileSystem();
  fakeFs.impl.setFile(PLAN_PATH, plan);
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

describe("acceptance: the plan side of lint", () => {
  // ac-header: a phase with the new header lines lints with no error at all.
  it("ac-header: the new header lines lint with no error", async () => {
    const report = await lint(acHeaderPlan());

    expect(report.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(hasLintErrors(report.findings)).toBe(false);
  });

  // ac-header-rules: a table of the two pairing defects.
  const headerRules = [
    { name: "a discharged-by value", plan: acHeaderDischargedPlan, row: DISCHARGED_BY_ROW },
    { name: "a phase line without its files line", plan: acHeaderNoFilesPlan, row: NO_FILES_ROW },
  ] as const;
  for (const c of headerRules) {
    it(`ac-header-rules: ${c.name} is refused with the acceptance message`, async () => {
      const report = await lint(c.plan());

      expect(report.findings).toContainEqual(c.row);
      expect(hasLintErrors(report.findings)).toBe(true);
    });
  }

  // ac-header-old: both Oracle lines are refused by name.
  it("ac-header-old: the Oracle phase and Oracle files lines are each refused", async () => {
    const report = await lint(acHeaderOldPlan());

    expect(report.findings).toContainEqual(OLD_PHASE_ROW);
    expect(report.findings).toContainEqual(OLD_FILES_ROW);
    expect(hasLintErrors(report.findings)).toBe(true);
  });

  // ac-loop-rules: a misplaced acceptance line and a silent acceptance phase.
  it("ac-loop-rules: both loop rules say acceptance", async () => {
    const report = await lint(acLoopRulesPlan());

    expect(report.findings).toContainEqual(MISPLACED_ROW);
    expect(report.findings).toContainEqual(SILENT_ROW);
    expect(hasLintErrors(report.findings)).toBe(true);
  });

  // ac-loop-old: a line in the retired oracle loop is refused by name.
  it("ac-loop-old: a line in the oracle loop is refused by name", async () => {
    const report = await lint(acLoopOldPlan());

    expect(report.findings).toContainEqual(OLD_LOOP_ROW);
    expect(hasLintErrors(report.findings)).toBe(true);
  });

  // ac-provider-missing: no acceptance key in any layer.
  it("ac-provider-missing: an acceptance phase with no provider is named", async () => {
    const report = await lint(acHeaderPlan(), withoutProvider);

    expect(report.findings).toContainEqual(NO_PROVIDER_ROW);
    expect(hasLintErrors(report.findings)).toBe(true);
  });
});

const errors = (report: LintReport) => report.findings.filter((f) => f.severity === "error");

// A plan rewritten halfway from the old names: the row refusing the old name
// names the fix, and the loop rules add no row that points elsewhere.
describe("lint of a plan half rewritten from the old names", () => {
  it("reports only the old header lines when the test line is already in the acceptance loop", async () => {
    expect(errors(await lint(halfRewrittenOldHeaderPlan()))).toEqual([
      OLD_PHASE_ROW,
      OLD_FILES_ROW,
    ]);
  });

  it("reports only the old loop when the header lines are already the new ones", async () => {
    expect(errors(await lint(halfRewrittenOldLoopPlan()))).toEqual([OLD_LOOP_ROW]);
  });
});
