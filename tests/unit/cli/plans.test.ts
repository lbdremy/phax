import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { runPlansStatus, runPlansLint } from "../../../src/cli/commands/plans.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";
import type { StalenessReport } from "../../../src/domain/artifact/render.js";
import type { LintReport } from "../../../src/app/lintPlan.js";

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

function makeOutput() {
  const lines: string[] = [];
  const errors: string[] = [];
  const out = {
    log: (m: string) => lines.push(m),
    warn: (m: string) => lines.push(`WARN: ${m}`),
    error: (m: string) => errors.push(m),
  };
  return { out, lines, errors };
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
    security: { mode: "secure", enforcedGates: [], allowedPaths: [], blockedCommands: [] },
    publish: {
      auto: false,
      remote: "origin",
      provider: "github",
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: { enabled: false, model: "claude-sonnet-4-6", effort: "medium" },
  };
}

const FRESH_STALE_REPORT: StalenessReport = [
  { path: "docs/plans/10-fresh.md", result: { kind: "fresh" } },
  {
    path: "docs/plans/20-stale.md",
    result: {
      kind: "stale",
      evidence: [{ reason: "self-changed" }],
    },
  },
];

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
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_REPORT));

    const { out, lines } = makeOutput();
    const code = await runPlansStatus({}, out);

    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("docs/plans/10-fresh.md: fresh");
    expect(text).toContain("docs/plans/20-stale.md: STALE");
    expect(text).toContain("self-changed");
    expect(applyStalenessReport).not.toHaveBeenCalled();
  });

  it("--apply calls the apply use case and reports the flipped plans", async () => {
    await setupConfig();
    const { plansStalenessReport, applyStalenessReport } = vi.mocked(
      await import("../../../src/app/planStaleness.js"),
    );
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_REPORT));
    applyStalenessReport.mockReturnValue(
      Effect.succeed([
        {
          path: "docs/plans/20-stale.md",
          verdict: { kind: "stale", evidence: [{ reason: "self-changed" }] },
        },
      ]),
    );

    const { out, lines } = makeOutput();
    const code = await runPlansStatus({ apply: true }, out);

    expect(code).toBe(0);
    expect(applyStalenessReport).toHaveBeenCalledTimes(1);
    const text = lines.join("\n");
    expect(text).toContain("docs/plans/20-stale.md: Approved -> Stale");
  });

  it("without --apply, the apply use case is not called", async () => {
    await setupConfig();
    const { plansStalenessReport, applyStalenessReport } = vi.mocked(
      await import("../../../src/app/planStaleness.js"),
    );
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_REPORT));

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
    plansStalenessReport.mockReturnValue(Effect.succeed(FRESH_STALE_REPORT));

    const { out, lines } = makeOutput();
    const code = await runPlansStatus({ json: true }, out);

    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n")) as { report: StalenessReport };
    expect(parsed.report).toEqual(FRESH_STALE_REPORT);
  });
});

describe("runPlansLint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("a config error exits 1 without calling the use case", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.left({ message: "bad phax.json" } as never));
    const { lintPlan } = vi.mocked(await import("../../../src/app/lintPlan.js"));

    const { out, errors } = makeOutput();
    const code = await runPlansLint("plan.md", {}, out);

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("bad phax.json");
    expect(lintPlan).not.toHaveBeenCalled();
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
