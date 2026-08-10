import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { runPlansStatus } from "../../../src/cli/commands/plans.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";
import type { StalenessReport } from "../../../src/domain/artifact/render.js";

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/planStaleness.js", () => ({
  plansStalenessReport: vi.fn(),
  applyStalenessReport: vi.fn(),
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
