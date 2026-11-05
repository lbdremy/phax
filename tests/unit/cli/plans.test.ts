import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect, Either } from "effect";
import { argShapes, fullName } from "../../../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../../../src/cli/definitions/program.js";
import { phaxCall } from "../../helpers/runnerCall.js";
import type { PlanOverview } from "../../../src/domain/plan/overview.js";
import { currentSchemaUrl } from "../../../src/schemas/persisted.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  type ResolvedConfig,
} from "../../../src/schemas/phaxConfig.js";
import { resolveRecordsConfig } from "../../../src/schemas/recordsConfig.js";
import { resolveSecurityConfig } from "../../../src/schemas/securityConfig.js";
import type { StalenessReport } from "../../../src/domain/artifact/render.js";
import type { LintReport } from "../../../src/app/lintPlan.js";
import type { PlansStalenessResult } from "../../../src/app/planStaleness.js";
import { ArtifactValidationError, ConfigValidationError } from "../../../src/domain/errors.js";

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/planStaleness.js", () => ({
  plansStalenessReport: vi.fn(),
  applyStalenessReport: vi.fn(),
}));

vi.mock("../../../src/app/lintPlan.js", () => ({
  lintPlan: vi.fn(),
}));

vi.mock("../../../src/app/planOverview.js", () => ({
  planOverview: vi.fn(),
}));

function makeConfig(): ResolvedConfig {
  return {
    raw: {} as ResolvedConfig["raw"],
    namespace: "louloupapers",
    stateRoot: "/fake-state",
    repoRoot: "/fake-repo",
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    security: resolveSecurityConfig(undefined, "secure"),
    publish: {
      auto: false,
      remote: "origin",
      provider: "github",
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: { enabled: false, model: "claude-sonnet-4-6", effort: "medium" },
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
    records: resolveRecordsConfig(undefined),
  };
}

const FRESH_STALE_REPORT: StalenessReport = [
  { path: "docs/plans/2609101210-fresh-plan.md", result: { kind: "fresh" } },
  {
    path: "docs/plans/2609101220-stale-plan.md",
    result: {
      kind: "stale",
      evidence: [{ reason: "self-changed" }],
    },
  },
];

const FRESH_STALE_RESULT: PlansStalenessResult = { report: FRESH_STALE_REPORT, orphanRecords: [] };

const GONE_PLAN_ORPHAN = {
  recordFile: "docs/plans/approvals/2609300900-gone-plan.json",
  artifact: "docs/plans/2609300900-gone-plan.md",
};
const GONE_PLAN_WARNING =
  "warning: orphan approval record docs/plans/approvals/2609300900-gone-plan.json — docs/plans/2609300900-gone-plan.md does not exist; delete the record file";

async function setupConfig(repoRoot?: string) {
  const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
  loadConfig.mockReturnValue(
    Either.right(repoRoot === undefined ? makeConfig() : { ...makeConfig(), repoRoot }),
  );
}

async function mockLint(report: LintReport) {
  const { lintPlan } = vi.mocked(await import("../../../src/app/lintPlan.js"));
  lintPlan.mockReturnValue(Effect.succeed(report));
  return lintPlan;
}

describe("runPlansStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders fresh and stale entries with reasons, exits 0", async () => {
    await setupConfig();
    const { plansStalenessReport, applyStalenessReport } = vi.mocked(
      await import("../../../src/app/planStaleness.js"),
    );
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_RESULT));

    const { code, outLines: lines } = await phaxCall(["plans", "status"]);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("docs/plans/2609101210-fresh-plan.md: fresh");
    expect(text).toContain("docs/plans/2609101220-stale-plan.md: STALE");
    expect(text).toContain("self-changed");
    expect(applyStalenessReport).not.toHaveBeenCalled();
  });

  it("--apply calls the apply use case and reports the flipped plans", async () => {
    // The flipped plan is read back from the repository for its written-file record.
    const repoRoot = mkdtempSync(join(tmpdir(), "phax-plans-status-"));
    mkdirSync(join(repoRoot, "docs/plans"), { recursive: true });
    writeFileSync(join(repoRoot, "docs/plans/2609101220-stale-plan.md"), "stale plan\n");
    await setupConfig(repoRoot);
    const { plansStalenessReport, applyStalenessReport } = vi.mocked(
      await import("../../../src/app/planStaleness.js"),
    );
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_RESULT));
    applyStalenessReport.mockReturnValue(
      Effect.succeed([
        {
          path: "docs/plans/2609101220-stale-plan.md",
          verdict: { kind: "stale", evidence: [{ reason: "self-changed" }] },
        },
      ]),
    );

    const { code, outLines: lines } = await phaxCall(["plans", "status", "--apply"]);

    expect(code).toBe(0);
    expect(applyStalenessReport).toHaveBeenCalledTimes(1);
    const text = lines.join("\n");
    expect(text).toContain("docs/plans/2609101220-stale-plan.md: Approved -> Stale");
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("without --apply, the apply use case is not called", async () => {
    await setupConfig();
    const { plansStalenessReport, applyStalenessReport } = vi.mocked(
      await import("../../../src/app/planStaleness.js"),
    );
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_RESULT));

    await phaxCall(["plans", "status"]);

    expect(applyStalenessReport).not.toHaveBeenCalled();
  });

  it("an app error exits non-zero with the message", async () => {
    await setupConfig();
    const { plansStalenessReport } = vi.mocked(await import("../../../src/app/planStaleness.js"));
    plansStalenessReport.mockReturnValue(
      Effect.fail({ _tag: "FsError", message: "boom: could not list docs/plans" } as never),
    );

    const { code, errLines: errors } = await phaxCall(["plans", "status"]);

    expect(code).not.toBe(0);
    expect(errors.join("\n")).toContain("boom");
  });

  it("--json emits the report as JSON", async () => {
    await setupConfig();
    const { plansStalenessReport } = vi.mocked(await import("../../../src/app/planStaleness.js"));
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_RESULT));

    const { code, outLines: lines } = await phaxCall(["plans", "status", "--json"]);

    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n")) as { report: StalenessReport };
    expect(parsed).toEqual({ report: FRESH_STALE_REPORT, orphanRecords: [] });
  });

  it("warns about an orphan record on stderr, keeping stdout and the exit code", async () => {
    await setupConfig();
    const { plansStalenessReport } = vi.mocked(await import("../../../src/app/planStaleness.js"));
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_RESULT));
    const clean = await phaxCall(["plans", "status"]);

    plansStalenessReport.mockReturnValue(
      Effect.succeed({ report: FRESH_STALE_REPORT, orphanRecords: [GONE_PLAN_ORPHAN] }),
    );
    const { code, outLines: lines, errLines: warnings } = await phaxCall(["plans", "status"]);

    expect(code).toBe(clean.code);
    expect(warnings).toEqual([GONE_PLAN_WARNING]);
    expect(lines).toEqual(clean.outLines);
    expect(clean.errLines).toEqual([]);
  });

  it("--json carries orphanRecords beside an unchanged report and still warns on stderr", async () => {
    await setupConfig();
    const { plansStalenessReport } = vi.mocked(await import("../../../src/app/planStaleness.js"));
    plansStalenessReport.mockReturnValue(
      Effect.succeed({ report: FRESH_STALE_REPORT, orphanRecords: [GONE_PLAN_ORPHAN] }),
    );

    const {
      code,
      outLines: lines,
      errLines: warnings,
    } = await phaxCall(["plans", "status", "--json"]);

    expect(code).toBe(0);
    expect(JSON.parse(lines.join("\n"))).toEqual({
      report: FRESH_STALE_REPORT,
      orphanRecords: [GONE_PLAN_ORPHAN],
    });
    // Under --json a note is a JSON line on stderr carrying the same text.
    expect(warnings.map((w) => (JSON.parse(w) as { text: string }).text)).toEqual([
      GONE_PLAN_WARNING,
    ]);
  });
});

describe("runPlansLint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exits 2 on an invalid config, as every command does, never lint's 1", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(
      Either.left(
        new ConfigValidationError({
          message: '"assignments" is accepted only in phax.json',
          path: "/fake-repo/phax.local.json",
        }),
      ),
    );
    const { lintPlan } = vi.mocked(await import("../../../src/app/lintPlan.js"));

    const { code, errLines: errors } = await phaxCall(["plans", "lint", "plan.md"]);

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain(
      'Config error: "assignments" is accepted only in phax.json',
    );
    expect(lintPlan).not.toHaveBeenCalled();
  });

  it("reads the absolutized path but reports the argument as typed", async () => {
    await setupConfig();
    const lintPlan = await mockLint({ plan: "docs/plans/2609101260-foo-plan.md", findings: [] });

    const { code, outLines: lines } = await phaxCall([
      "plans",
      "lint",
      "docs/plans/2609101260-foo-plan.md",
    ]);

    expect(code).toBe(0);
    expect(lintPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        planMdPath: resolve(process.cwd(), "docs/plans/2609101260-foo-plan.md"),
        reportPath: "docs/plans/2609101260-foo-plan.md",
      }),
    );
    // The header names the path the user typed, not the resolved one.
    expect(lines.join("\n")).toBe("docs/plans/2609101260-foo-plan.md: no findings");
  });

  it("exits 0 and renders the report when only warnings are found", async () => {
    await setupConfig();
    await mockLint({
      plan: "/fake-repo/plan.md",
      findings: [
        {
          severity: "warning",
          check: "files",
          phase: "phase-01",
          message: "create src/b.ts: also listed under optional files",
        },
      ],
    });

    const { code, outLines: lines } = await phaxCall(["plans", "lint", "plan.md"]);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("0 errors, 1 warning");
    expect(text).toContain("also listed under optional files");
  });

  it("exits 1 when at least one finding is an error", async () => {
    await setupConfig();
    await mockLint({
      plan: "/fake-repo/plan.md",
      findings: [
        {
          severity: "error",
          check: "structure",
          phase: "phase-02",
          message: 'missing "### Planned files to edit" section',
        },
      ],
    });

    const { code } = await phaxCall(["plans", "lint", "plan.md"]);

    expect(code).toBe(1);
  });

  it("exits 0 with no findings", async () => {
    await setupConfig();
    await mockLint({ plan: "/fake-repo/plan.md", findings: [] });

    const { code, outLines: lines } = await phaxCall(["plans", "lint", "plan.md"]);

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("no findings");
  });

  it("--json emits the plan-lint document, $schema first, and nothing else", async () => {
    await setupConfig();
    const report: LintReport = {
      plan: "/fake-repo/plan.md",
      findings: [
        { severity: "error", check: "models", phase: "phase-01", message: "nope / high: unknown" },
      ],
    };
    await mockLint(report);

    const { code, out: stdout } = await phaxCall(["plans", "lint", "plan.md", "--json"]);

    expect(code).toBe(1);
    // The whole of stdout is the one document (pretty-printed over several lines).
    const document = JSON.parse(stdout) as Record<string, unknown>;
    expect(Object.keys(document)[0]).toBe("$schema");
    expect(document).toEqual({ $schema: currentSchemaUrl("plan-lint"), ...report });
  });

  it("passes the plan's path relative to the repo root as repoRelPath", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right({ ...makeConfig(), repoRoot: process.cwd() }));
    const lintPlan = await mockLint({ plan: "docs/plans/2609101260-foo-plan.md", findings: [] });

    await phaxCall(["plans", "lint", "docs/plans/2609101260-foo-plan.md"]);

    expect(lintPlan).toHaveBeenCalledWith(
      expect.objectContaining({ repoRelPath: "docs/plans/2609101260-foo-plan.md" }),
    );
  });

  it("an off-grammar repo-tracked plan exits 12 with the validation message", async () => {
    await setupConfig();
    const { lintPlan } = vi.mocked(await import("../../../src/app/lintPlan.js"));
    const message = "docs/plans/foo-plan.md: name does not match <YYMMDDHHMM>-<slug>-plan.md";
    lintPlan.mockReturnValue(
      Effect.fail(new ArtifactValidationError({ path: "docs/plans/foo-plan.md", message })),
    );

    const {
      code,
      errLines: errors,
      outLines: lines,
    } = await phaxCall(["plans", "lint", "docs/plans/foo-plan.md"]);

    expect(code).toBe(12);
    expect(errors).toEqual([message]);
    expect(lines).toEqual([]);
  });

  it("a use-case failure reports the message and exits non-zero", async () => {
    await setupConfig();
    const { lintPlan } = vi.mocked(await import("../../../src/app/lintPlan.js"));
    lintPlan.mockReturnValue(
      Effect.fail({ _tag: "FsError", message: "ENOENT: plan.md" } as never) as never,
    );

    const { code, errLines: errors } = await phaxCall(["plans", "lint", "plan.md"]);

    expect(code).not.toBe(0);
    expect(errors.join("\n")).toContain("ENOENT");
  });
});

const OVERVIEW: PlanOverview = {
  plan: "plan.md",
  name: "widget",
  title: "Made-up widget",
  frontmatter: { kind: "decoded", status: "Draft" },
  sourceSpec: null,
  architecture: { kind: "none" },
  phases: [],
  coverage: { kind: "no-source-spec" },
};

async function mockOverview(result: Effect.Effect<PlanOverview> | Effect.Effect<never, unknown>) {
  const { planOverview } = vi.mocked(await import("../../../src/app/planOverview.js"));
  planOverview.mockReturnValue(result as never);
  return planOverview;
}

describe("runPlansOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exits 2 on an invalid config and reads nothing", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(
      Either.left(
        new ConfigValidationError({ message: "bad phax.json", path: "/fake-repo/phax.json" }),
      ),
    );
    const planOverview = await mockOverview(Effect.succeed(OVERVIEW));

    const { code, errLines: errors } = await phaxCall(["plans", "overview", "plan.md"]);

    expect(code).toBe(2);
    expect(errors).toEqual(["Config error: bad phax.json"]);
    expect(planOverview).not.toHaveBeenCalled();
  });

  it("reads the absolutized path but reports the argument as typed", async () => {
    await setupConfig();
    const planOverview = await mockOverview(Effect.succeed(OVERVIEW));

    const { code, outLines: lines } = await phaxCall([
      "plans",
      "overview",
      "docs/plans/2609101260-foo-plan.md",
    ]);

    expect(code).toBe(0);
    expect(planOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        planMdPath: resolve(process.cwd(), "docs/plans/2609101260-foo-plan.md"),
        reportPath: "docs/plans/2609101260-foo-plan.md",
      }),
    );
    expect(lines.join("\n")).toContain("widget — Made-up widget  (Draft · no source spec)");
  });

  it("--json prints the plan-overview document as the only thing on stdout", async () => {
    await setupConfig();
    await mockOverview(Effect.succeed(OVERVIEW));

    const {
      code,
      out: stdout,
      errLines: warnings,
    } = await phaxCall(["plans", "overview", "plan.md", "--json"]);

    expect(code).toBe(0);
    // The whole of stdout is the one document (pretty-printed over several lines).
    const document = JSON.parse(stdout) as Record<string, unknown>;
    expect(Object.keys(document)[0]).toBe("$schema");
    expect(document).toEqual({ $schema: currentSchemaUrl("plan-overview"), ...OVERVIEW });
    expect(warnings).toEqual([]);
  });

  it("warns once on stderr when the architecture failed, and still exits 0", async () => {
    await setupConfig();
    await mockOverview(
      Effect.succeed({ ...OVERVIEW, architecture: { kind: "failed", message: "boom" } }),
    );

    const { code, errLines: warnings } = await phaxCall(["plans", "overview", "plan.md"]);

    expect(code).toBe(0);
    expect(warnings).toEqual(["Warning: architecture provider failed: boom"]);
  });

  it("prints a failure's line on stderr, nothing on stdout, and exits 1", async () => {
    await setupConfig();
    const line = "plan.md: the plan does not parse — run phax plans lint plan.md";
    await mockOverview(Effect.fail({ kind: "unparsable", line }));

    const {
      code,
      errLines: errors,
      outLines: lines,
    } = await phaxCall(["plans", "overview", "plan.md"]);

    expect(code).toBe(1);
    expect(errors).toEqual([line]);
    expect(lines).toEqual([]);
  });

  it("is declared under plans as overview, with a <plan> argument and no option of its own", () => {
    const overviewCmd = phaxProgram.commands.find(
      (command) => fullName(command).join(" ") === "plans overview",
    );

    expect(overviewCmd).toBeDefined();
    const args = overviewCmd?.input.args;
    expect(args === undefined ? [] : argShapes(args.contract).map((a) => a.name)).toEqual(["plan"]);
    expect(overviewCmd?.input.flags).toBeUndefined();
  });
});
