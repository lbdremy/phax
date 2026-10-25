import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { Effect, Either } from "effect";
import { Command } from "commander";
import {
  registerPlansCommand,
  runPlansStatus,
  runPlansLint,
} from "../../../src/cli/commands/plans.js";
import { runPlansOverview } from "../../../src/cli/commands/plansOverview.js";
import type { PlanOverview } from "../../../src/domain/plan/overview.js";
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

function makeOutput() {
  const lines: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const out = {
    log: (m: string) => lines.push(m),
    warn: (m: string) => warnings.push(m),
    error: (m: string) => errors.push(m),
  };
  return { out, lines, warnings, errors };
}

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

async function setupConfig() {
  const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
  loadConfig.mockReturnValue(Either.right(makeConfig()));
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

    const { out, lines } = makeOutput();
    const code = await runPlansStatus({}, out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("docs/plans/2609101210-fresh-plan.md: fresh");
    expect(text).toContain("docs/plans/2609101220-stale-plan.md: STALE");
    expect(text).toContain("self-changed");
    expect(applyStalenessReport).not.toHaveBeenCalled();
  });

  it("--apply calls the apply use case and reports the flipped plans", async () => {
    await setupConfig();
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

    const { out, lines } = makeOutput();
    const code = await runPlansStatus({ apply: true }, out);

    expect(code).toBe(0);
    expect(applyStalenessReport).toHaveBeenCalledTimes(1);
    const text = lines.join("\n");
    expect(text).toContain("docs/plans/2609101220-stale-plan.md: Approved -> Stale");
  });

  it("without --apply, the apply use case is not called", async () => {
    await setupConfig();
    const { plansStalenessReport, applyStalenessReport } = vi.mocked(
      await import("../../../src/app/planStaleness.js"),
    );
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_RESULT));

    const { out } = makeOutput();
    await runPlansStatus({}, out);

    expect(applyStalenessReport).not.toHaveBeenCalled();
  });

  it("an app error exits non-zero with the message", async () => {
    await setupConfig();
    const { plansStalenessReport } = vi.mocked(await import("../../../src/app/planStaleness.js"));
    plansStalenessReport.mockReturnValue(
      Effect.fail({ _tag: "FsError", message: "boom: could not list docs/plans" } as never),
    );

    const { out, errors } = makeOutput();
    const code = await runPlansStatus({}, out);

    expect(code).not.toBe(0);
    expect(errors.join("\n")).toContain("boom");
  });

  it("--json emits the report as JSON", async () => {
    await setupConfig();
    const { plansStalenessReport } = vi.mocked(await import("../../../src/app/planStaleness.js"));
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_RESULT));

    const { out, lines } = makeOutput();
    const code = await runPlansStatus({ json: true }, out);

    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n")) as { report: StalenessReport };
    expect(parsed).toEqual({ report: FRESH_STALE_REPORT, orphanRecords: [] });
  });

  it("warns about an orphan record on stderr, keeping stdout and the exit code", async () => {
    await setupConfig();
    const { plansStalenessReport } = vi.mocked(await import("../../../src/app/planStaleness.js"));
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_RESULT));
    const clean = makeOutput();
    const cleanCode = await runPlansStatus({}, clean.out);

    plansStalenessReport.mockReturnValue(
      Effect.succeed({ report: FRESH_STALE_REPORT, orphanRecords: [GONE_PLAN_ORPHAN] }),
    );
    const { out, lines, warnings } = makeOutput();
    const code = await runPlansStatus({}, out);

    expect(code).toBe(cleanCode);
    expect(warnings).toEqual([GONE_PLAN_WARNING]);
    expect(lines).toEqual(clean.lines);
    expect(clean.warnings).toEqual([]);
  });

  it("--json carries orphanRecords beside an unchanged report and still warns on stderr", async () => {
    await setupConfig();
    const { plansStalenessReport } = vi.mocked(await import("../../../src/app/planStaleness.js"));
    plansStalenessReport.mockReturnValue(
      Effect.succeed({ report: FRESH_STALE_REPORT, orphanRecords: [GONE_PLAN_ORPHAN] }),
    );

    const { out, lines, warnings } = makeOutput();
    const code = await runPlansStatus({ json: true }, out);

    expect(code).toBe(0);
    expect(JSON.parse(lines.join("\n"))).toEqual({
      report: FRESH_STALE_REPORT,
      orphanRecords: [GONE_PLAN_ORPHAN],
    });
    expect(warnings).toEqual([GONE_PLAN_WARNING]);
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

    const { out, errors } = makeOutput();
    const code = await runPlansLint("plan.md", {}, out);

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain(
      'Config error: "assignments" is accepted only in phax.json',
    );
    expect(lintPlan).not.toHaveBeenCalled();
  });

  it("reads the absolutized path but reports the argument as typed", async () => {
    await setupConfig();
    const lintPlan = await mockLint({ plan: "docs/plans/2609101260-foo-plan.md", findings: [] });

    const { out, lines } = makeOutput();
    const code = await runPlansLint("docs/plans/2609101260-foo-plan.md", {}, out);

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

    const { out, lines } = makeOutput();
    const code = await runPlansLint("plan.md", {}, out);

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

    const { out } = makeOutput();
    const code = await runPlansLint("plan.md", {}, out);

    expect(code).toBe(1);
  });

  it("exits 0 with no findings", async () => {
    await setupConfig();
    await mockLint({ plan: "/fake-repo/plan.md", findings: [] });

    const { out, lines } = makeOutput();
    const code = await runPlansLint("plan.md", {}, out);

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("no findings");
  });

  it("--json emits the report verbatim and nothing else", async () => {
    await setupConfig();
    const report: LintReport = {
      plan: "/fake-repo/plan.md",
      findings: [
        { severity: "error", check: "models", phase: "phase-01", message: "nope / high: unknown" },
      ],
    };
    await mockLint(report);

    const { out, lines } = makeOutput();
    const code = await runPlansLint("plan.md", { json: true }, out);

    expect(code).toBe(1);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(report);
  });

  it("passes the plan's path relative to the repo root as repoRelPath", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right({ ...makeConfig(), repoRoot: process.cwd() }));
    const lintPlan = await mockLint({ plan: "docs/plans/2609101260-foo-plan.md", findings: [] });

    const { out } = makeOutput();
    await runPlansLint("docs/plans/2609101260-foo-plan.md", {}, out);

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

    const { out, errors, lines } = makeOutput();
    const code = await runPlansLint("docs/plans/foo-plan.md", {}, out);

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

    const { out, errors } = makeOutput();
    const code = await runPlansLint("plan.md", {}, out);

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

    const { out, errors } = makeOutput();
    const code = await runPlansOverview("plan.md", {}, out);

    expect(code).toBe(2);
    expect(errors).toEqual(["Config error: bad phax.json"]);
    expect(planOverview).not.toHaveBeenCalled();
  });

  it("reads the absolutized path but reports the argument as typed", async () => {
    await setupConfig();
    const planOverview = await mockOverview(Effect.succeed(OVERVIEW));

    const { out, lines } = makeOutput();
    const code = await runPlansOverview("docs/plans/2609101260-foo-plan.md", {}, out);

    expect(code).toBe(0);
    expect(planOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        planMdPath: resolve(process.cwd(), "docs/plans/2609101260-foo-plan.md"),
        reportPath: "docs/plans/2609101260-foo-plan.md",
      }),
    );
    expect(lines.join("\n")).toContain("widget — Made-up widget  (Draft · no source spec)");
  });

  it("--json prints the overview as the only thing on stdout", async () => {
    await setupConfig();
    await mockOverview(Effect.succeed(OVERVIEW));

    const { out, lines, warnings } = makeOutput();
    const code = await runPlansOverview("plan.md", { json: true }, out);

    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(OVERVIEW);
    expect(warnings).toEqual([]);
  });

  it("warns once on stderr when the architecture failed, and still exits 0", async () => {
    await setupConfig();
    await mockOverview(
      Effect.succeed({ ...OVERVIEW, architecture: { kind: "failed", message: "boom" } }),
    );

    const { out, warnings } = makeOutput();
    const code = await runPlansOverview("plan.md", {}, out);

    expect(code).toBe(0);
    expect(warnings).toEqual(["Warning: architecture provider failed: boom"]);
  });

  it("prints a failure's line on stderr, nothing on stdout, and exits 1", async () => {
    await setupConfig();
    const line = "plan.md: the plan does not parse — run phax plans lint plan.md";
    await mockOverview(Effect.fail({ kind: "unparsable", line }));

    const { out, errors, lines } = makeOutput();
    const code = await runPlansOverview("plan.md", {}, out);

    expect(code).toBe(1);
    expect(errors).toEqual([line]);
    expect(lines).toEqual([]);
  });

  it("is registered under plans as overview, with --json", () => {
    const program = new Command();
    registerPlansCommand(program, makeOutput().out);
    const plansCmd = program.commands.find((c) => c.name() === "plans");
    const overviewCmd = plansCmd?.commands.find((c) => c.name() === "overview");

    expect(overviewCmd).toBeDefined();
    expect(overviewCmd?.registeredArguments.map((a) => a.name())).toEqual(["plan"]);
    expect(overviewCmd?.options.map((o) => o.long)).toEqual(["--json"]);
  });
});
