import { describe, expect, it, vi, beforeEach } from "vitest";
import { Either } from "effect";
import { runEnterPhase } from "../../../src/cli/commands/enterPhase.js";

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/resolveRunRef.js", () => ({
  resolveRunRef: vi.fn(),
}));

vi.mock("../../../src/app/agentBinding.js", () => ({
  readAgentBinding: vi.fn(),
}));

vi.mock("../../../src/infra/session.js", () => ({
  makeNodeSessionLayer: vi.fn(),
}));

function makeOutput() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    out: {
      log: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(`WARN: ${m}`),
      error: (m: string) => errors.push(m),
    },
    lines,
    errors,
  };
}

function makeConfig(namespace = "acme") {
  return {
    raw: {} as never,
    namespace,
    stateRoot: "/fake-state",
    repoRoot: "/fake-repo",
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    security: {
      mode: "secure" as const,
      enforcedGates: [],
      allowedPaths: [],
      blockedCommands: [],
    },
    publish: {
      auto: false,
      remote: "origin",
      provider: "github" as const,
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: {
      enabled: false,
      model: "claude-sonnet-4-6",
      effort: "medium" as const,
    },
  };
}

function makeRunInfo(
  namespace: string,
  shortName: string,
  phaseId = "phase-01",
): import("../../../src/domain/runReviewInfo.js").RunReviewInfo {
  return {
    namespace,
    shortName,
    runId: `run-${shortName}`,
    runState: "review_open",
    branch: `phax/${shortName}`,
    runTitle: "Test run",
    finalPhaseBranch: `phax/${shortName}--phase-01` as never,
    stateRoot: "/fake-state",
    runPath: `/fake-state/${namespace}/${shortName}`,
    finalPhaseId: phaseId,
    finalPhaseTitle: "Phase 01",
    worktreePath: `/fake-worktrees/${shortName}`,
    claudeSessionId: undefined,
    gateProfileId: undefined,
    phaseStatuses: [
      {
        phaseId,
        title: "Phase 01",
        state: "review_open",
        branch: `phax/${shortName}--${phaseId}` as never,
        worktreePath: `/fake-worktrees/${shortName}/${phaseId}`,
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: undefined,
        fixAttempts: 0,
        lastError: undefined,
      },
    ],
    planPhases: [{ id: phaseId, title: "Phase 01" }],
    updatedAt: "2026-01-01T00:00:00Z",
    stoppedReason: undefined,
    lastError: undefined,
  };
}

describe("runEnterPhase — namespace-scoped resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a run via resolveRunRef (namespace-scoped) and shows qualified name for cross-project runs", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig("acme")));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    const info = makeRunInfo("other", "fixbug");
    resolveRunRef.mockReturnValue(
      Either.right({ namespace: "other", shortName: "fixbug", info, crossProject: true }),
    );

    const { readAgentBinding } = vi.mocked(await import("../../../src/app/agentBinding.js"));
    const { makeNodeSessionLayer } = vi.mocked(await import("../../../src/infra/session.js"));
    readAgentBinding.mockResolvedValue(Either.left("no binding"));
    makeNodeSessionLayer.mockReturnValue(undefined as never);

    const { out, lines, errors } = makeOutput();
    const code = await runEnterPhase("other.fixbug", "phase-01", out);

    // resolveRunRef was called with the raw arg
    expect(resolveRunRef).toHaveBeenCalledWith(
      "other.fixbug",
      expect.anything(),
      expect.any(String),
    );
    // qualified name is shown for cross-project runs
    expect(lines.join("\n")).toContain("other.fixbug");
    // binding failed → exit 1 with error mentioning qualified name
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("other.fixbug");
  });

  it("resolves phase from phaseStatuses (not a separate resolvePhaseInfo call)", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig("acme")));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    const info = makeRunInfo("acme", "fixbug", "phase-02");
    resolveRunRef.mockReturnValue(
      Either.right({ namespace: "acme", shortName: "fixbug", info, crossProject: false }),
    );

    const { readAgentBinding } = vi.mocked(await import("../../../src/app/agentBinding.js"));
    readAgentBinding.mockResolvedValue(Either.left("no binding"));

    const { out, errors } = makeOutput();
    const code = await runEnterPhase("fixbug", "phase-02", out);

    // Phase found in phaseStatuses → proceeds to binding, which fails → exit 1
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("phase-02");
  });

  it("returns 1 with phase-not-found error when phaseId is absent from phaseStatuses", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig("acme")));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    const info = makeRunInfo("acme", "fixbug", "phase-01");
    resolveRunRef.mockReturnValue(
      Either.right({ namespace: "acme", shortName: "fixbug", info, crossProject: false }),
    );

    const { out, errors } = makeOutput();
    const code = await runEnterPhase("fixbug", "phase-99", out);

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("phase-99");
  });

  it("returns 1 when resolveRunRef fails (run not found)", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig("acme")));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    resolveRunRef.mockReturnValue(
      Either.left({ variant: "not-found" as const, message: 'Run "acme.unknown" not found.' }),
    );

    const { out, errors } = makeOutput();
    const code = await runEnterPhase("unknown", "phase-01", out);

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("not found");
  });

  it("two same-short-name runs in different namespaces resolve independently", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    const { readAgentBinding } = vi.mocked(await import("../../../src/app/agentBinding.js"));
    readAgentBinding.mockResolvedValue(Either.left("no binding"));

    // First call: inside namespace "alpha"
    loadConfig.mockReturnValue(Either.right(makeConfig("alpha")));
    const infoAlpha = makeRunInfo("alpha", "fixbug");
    resolveRunRef.mockReturnValue(
      Either.right({
        namespace: "alpha",
        shortName: "fixbug",
        info: infoAlpha,
        crossProject: false,
      }),
    );
    const { out: outA, errors: errA } = makeOutput();
    const codeA = await runEnterPhase("fixbug", "phase-01", outA);

    // Second call: inside namespace "beta"
    loadConfig.mockReturnValue(Either.right(makeConfig("beta")));
    const infoBeta = makeRunInfo("beta", "fixbug");
    resolveRunRef.mockReturnValue(
      Either.right({ namespace: "beta", shortName: "fixbug", info: infoBeta, crossProject: false }),
    );
    const { out: outB, errors: errB } = makeOutput();
    const codeB = await runEnterPhase("fixbug", "phase-01", outB);

    // Both fail at binding but with their respective qualified names
    expect(codeA).toBe(1);
    expect(errA.join("\n")).toContain("alpha.fixbug");
    expect(codeB).toBe(1);
    expect(errB.join("\n")).toContain("beta.fixbug");
  });
});
