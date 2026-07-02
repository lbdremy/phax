import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { runReviewCompliance } from "../../../src/cli/commands/reviewCompliance.js";
import type { RunReviewInfo } from "../../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../../src/domain/branded.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";

const FAKE_SHORT_NAME = "my-run";
const QUALIFIED_NAME = "louloupapers.article-series-taxonomy";

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/resolveRunRef.js", () => ({
  resolveRunRef: vi.fn(),
}));

vi.mock("../../../src/app/reviewCompliance.js", () => ({
  reviewCompliance: vi.fn(),
}));

vi.mock("../../../src/app/loadRouting.js", () => ({
  loadModelRouting: vi.fn(),
  loadProviderConfig: vi.fn(),
}));

vi.mock("../../../src/app/projectContext.js", () => ({
  effectiveStateRoot: vi.fn().mockReturnValue("/fake-state"),
}));

vi.mock("../../../src/domain/routing/resolve.js", () => ({
  resolveModel: vi
    .fn()
    .mockReturnValue({ kind: "resolved", provider: "claude", model: "claude-sonnet-4-6" }),
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

function makeConfig(enabled: boolean): ResolvedConfig {
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
    complianceReview: { enabled, model: "claude-sonnet-4-6", effort: "medium" },
  };
}

function makeInfo(shortName = FAKE_SHORT_NAME): RunReviewInfo {
  return {
    namespace: "louloupapers",
    shortName,
    runId: "run-999",
    runState: "review_open",
    branch: `feature/${shortName}`,
    runTitle: "My Run",
    finalPhaseBranch: `feature/${shortName}--phase-01` as BranchName,
    stateRoot: "/fake-state",
    runPath: `/fake-state/runs/${shortName}`,
    finalPhaseId: "phase-01",
    finalPhaseTitle: "Phase One",
    worktreePath: "/wt",
    claudeSessionId: undefined,
    gateProfileId: "full",
    phaseStatuses: [],
    planPhases: [],
    updatedAt: "2026-06-12T00:00:00Z",
    stoppedReason: undefined,
    lastError: undefined,
  };
}

describe("runReviewCompliance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 1 when compliance review is not enabled", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(false)));

    const { out, errors } = makeOutput();
    const code = await runReviewCompliance(FAKE_SHORT_NAME, {}, out);
    expect(code).toBe(1);
    expect(errors.join("")).toContain("review.compliance is not enabled");
  });

  it("does not call resolveRunRef when compliance is disabled", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(false)));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));

    const { out } = makeOutput();
    await runReviewCompliance(FAKE_SHORT_NAME, {}, out);
    expect(resolveRunRef).not.toHaveBeenCalled();
  });

  it("regression: accepts qualified namespace.shortName without Invalid short name error", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(true)));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    resolveRunRef.mockReturnValue(
      Either.right({
        namespace: "louloupapers",
        shortName: "article-series-taxonomy",
        info: makeInfo("article-series-taxonomy"),
        crossProject: false,
      }),
    );

    const { reviewCompliance } = vi.mocked(await import("../../../src/app/reviewCompliance.js"));
    reviewCompliance.mockReturnValue(
      Effect.succeed({ kind: "generated", verdict: "pass", structuredVerdictMissing: false }),
    );

    const { loadModelRouting, loadProviderConfig } = vi.mocked(
      await import("../../../src/app/loadRouting.js"),
    );
    loadModelRouting.mockReturnValue(Effect.succeed({ families: [] }));
    loadProviderConfig.mockReturnValue(Effect.succeed({}));

    const { out, errors } = makeOutput();
    const code = await runReviewCompliance(QUALIFIED_NAME, {}, out);

    expect(resolveRunRef).toHaveBeenCalledWith(
      QUALIFIED_NAME,
      expect.anything(),
      expect.anything(),
    );
    expect(errors.join("")).not.toContain("Invalid short name");
    expect(code).toBe(0);
  });

  it("returns 1 and renders refusal message when resolveRunRef fails", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(true)));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    resolveRunRef.mockReturnValue(
      Either.left({ variant: "not-found" as const, message: "Run not found in registry." }),
    );

    const { out, errors } = makeOutput();
    const code = await runReviewCompliance(FAKE_SHORT_NAME, {}, out);
    expect(code).toBe(1);
    expect(errors).toContain("Run not found in registry.");
  });

  it("logs Target: when crossProject is true", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(true)));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    resolveRunRef.mockReturnValue(
      Either.right({
        namespace: "other-ns",
        shortName: FAKE_SHORT_NAME,
        info: { ...makeInfo(), namespace: "other-ns" },
        crossProject: true,
      }),
    );

    const { reviewCompliance } = vi.mocked(await import("../../../src/app/reviewCompliance.js"));
    reviewCompliance.mockReturnValue(
      Effect.succeed({ kind: "generated", verdict: "pass", structuredVerdictMissing: false }),
    );

    const { loadModelRouting, loadProviderConfig } = vi.mocked(
      await import("../../../src/app/loadRouting.js"),
    );
    loadModelRouting.mockReturnValue(Effect.succeed({ families: [] }));
    loadProviderConfig.mockReturnValue(Effect.succeed({}));

    const { out, lines } = makeOutput();
    await runReviewCompliance(FAKE_SHORT_NAME, {}, out);
    expect(lines.join("")).toContain(`Target: other-ns.${FAKE_SHORT_NAME}`);
  });
});
