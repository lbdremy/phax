import { describe, expect, it } from "vitest";
import { renderLintReport } from "../../src/domain/plan/lintRender.js";
import type { LintFinding } from "../../src/domain/plan/lint.js";

const ERROR_FINDING: LintFinding = {
  severity: "error",
  check: "files",
  phase: "phase-02",
  message: "edit src/a.ts: does not exist and no earlier phase creates it",
};

const WARNING_FINDING: LintFinding = {
  severity: "warning",
  check: "files",
  phase: "phase-01",
  message: "create src/b.ts: also listed under optional files",
};

const PLAN_LEVEL_FINDING: LintFinding = {
  severity: "error",
  check: "commands",
  phase: null,
  message: 'required command "deno" is not covered by security.agentCommands or the gate profile',
};

const row = (check: LintFinding["check"], message: string): LintFinding => ({
  severity: "error",
  check,
  phase: "phase-03",
  message,
});

describe("renderLintReport", () => {
  it("reports no findings", () => {
    const text = renderLintReport({ plan: "docs/plans/2609101260-foo-plan.md", findings: [] });
    expect(text).toBe("docs/plans/2609101260-foo-plan.md: no findings");
  });

  it("counts errors and warnings in the header", () => {
    const text = renderLintReport({
      plan: "plan.md",
      findings: [ERROR_FINDING, WARNING_FINDING, PLAN_LEVEL_FINDING],
    });
    expect(text.split("\n")[0]).toBe("plan.md: 2 errors, 1 warning");
  });

  it("uses singular counts for a single finding of each kind", () => {
    const text = renderLintReport({ plan: "plan.md", findings: [ERROR_FINDING, WARNING_FINDING] });
    expect(text.split("\n")[0]).toBe("plan.md: 1 error, 1 warning");
  });

  it("renders one line per finding with severity, check, phase and message", () => {
    const text = renderLintReport({ plan: "plan.md", findings: [ERROR_FINDING] });
    const line = text.split("\n")[1] ?? "";
    expect(line.trimEnd()).toBe(
      "error    files        phase-02  edit src/a.ts: does not exist and no earlier phase creates it",
    );
  });

  // The acceptance-tests spec's §6 report, whole. The check column is as wide as
  // the widest check, `interactive`, one more than the spec's sketch gives it.
  it("renders acceptance and tests rows in aligned columns", () => {
    const text = renderLintReport({
      plan: "docs/plans/2610271100-publish-plan.md",
      findings: [
        row("acceptance", "**Oracle phase:** is no longer read: write **Acceptance phase:**"),
        row("acceptance", "**Oracle files:** is no longer read: write **Acceptance test files:**"),
        row(
          "tests",
          "test line 1 uses the loop 'oracle', which is no longer read: write 'acceptance'",
        ),
      ],
    });
    expect(text).toBe(
      [
        "docs/plans/2610271100-publish-plan.md: 3 errors, 0 warnings",
        "error    acceptance   phase-03  **Oracle phase:** is no longer read: write **Acceptance phase:**",
        "error    acceptance   phase-03  **Oracle files:** is no longer read: write **Acceptance test files:**",
        "error    tests        phase-03  test line 1 uses the loop 'oracle', which is no longer read: write 'acceptance'",
      ].join("\n"),
    );
  });

  it("renders a plan-level finding's phase as a dash", () => {
    const text = renderLintReport({ plan: "plan.md", findings: [PLAN_LEVEL_FINDING] });
    const line = text.split("\n")[1] ?? "";
    expect(line).toContain("commands");
    expect(line).toContain("-  ");
    expect(line).toContain('required command "deno"');
  });
});
