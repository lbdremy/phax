import { describe, expect, it, vi, beforeEach } from "vitest";
import { Result } from "effect";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";
import { phaseStatus } from "../../helpers/phaseStatusFixture.js";
import { phaxCall } from "../../helpers/runnerCall.js";

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

// No test reads ~/.phax: providers.json is the built-in catalog.
vi.mock("../../../src/app/loadRouting.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/app/loadRouting.js")>();
  const { Effect } = await import("effect");
  const { DEFAULT_PROVIDER_CONFIG } = await import("../../../src/domain/routing/defaults.js");
  return { ...original, loadProviderConfig: () => Effect.succeed(DEFAULT_PROVIDER_CONFIG) };
});

/** `phax enter-phase <run> <phase>` through the runner: stdout lines and stderr lines. */
async function runEnterPhase(shortName: string, phaseId: string) {
  const result = await phaxCall(["enter-phase", shortName, phaseId]);
  return { code: result.code, lines: result.outLines, errors: result.errLines };
}

function makeConfig(namespace = "acme"): ResolvedConfig {
  return {
    raw: {} as never,
    namespace,
    stateRoot: "/fake-state",
    repoRoot: "/fake-repo",
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    security: {
      profile: "secure",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    publish: {
      auto: false,
      remote: "origin",
      provider: "github",
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: {
      enabled: false,
      model: "claude-sonnet-4-6",
      effort: "medium",
    },
    codeReview: { enabled: false, model: "claude-opus-5-5", effort: "high" },
    authoring: {
      spec: { model: "claude-opus-5-5", effort: "high" },
      plan: { model: "claude-opus-5-5", effort: "high" },
    },
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
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
      phaseStatus({
        phaseId,
        phaseIndex: 0,
        state: "review_open",
        model: "claude-sonnet-4-6",
        effort: "medium",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        branchName: `phax/${shortName}--${phaseId}`,
        base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        worktreePath: `/fake-worktrees/${shortName}/${phaseId}`,
      }),
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
    loadConfig.mockReturnValue(Result.succeed(makeConfig("acme")));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    const info = makeRunInfo("other", "fixbug");
    resolveRunRef.mockReturnValue(
      Result.succeed({ namespace: "other", shortName: "fixbug", info, crossProject: true }),
    );

    const { readAgentBinding } = vi.mocked(await import("../../../src/app/agentBinding.js"));
    const { makeNodeSessionLayer } = vi.mocked(await import("../../../src/infra/session.js"));
    readAgentBinding.mockResolvedValue(Result.fail("no binding"));
    makeNodeSessionLayer.mockReturnValue(undefined as never);

    const { code, lines, errors } = await runEnterPhase("other.fixbug", "phase-01");

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
    loadConfig.mockReturnValue(Result.succeed(makeConfig("acme")));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    const info = makeRunInfo("acme", "fixbug", "phase-02");
    resolveRunRef.mockReturnValue(
      Result.succeed({ namespace: "acme", shortName: "fixbug", info, crossProject: false }),
    );

    const { readAgentBinding } = vi.mocked(await import("../../../src/app/agentBinding.js"));
    readAgentBinding.mockResolvedValue(Result.fail("no binding"));

    const { code, errors } = await runEnterPhase("fixbug", "phase-02");

    // Phase found in phaseStatuses → proceeds to binding, which fails → exit 1
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("phase-02");
  });

  it("returns 1 with phase-not-found error when phaseId is absent from phaseStatuses", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Result.succeed(makeConfig("acme")));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    const info = makeRunInfo("acme", "fixbug", "phase-01");
    resolveRunRef.mockReturnValue(
      Result.succeed({ namespace: "acme", shortName: "fixbug", info, crossProject: false }),
    );

    const { code, errors } = await runEnterPhase("fixbug", "phase-99");

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("phase-99");
  });

  it("returns 1 when resolveRunRef fails (run not found)", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Result.succeed(makeConfig("acme")));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    resolveRunRef.mockReturnValue(
      Result.fail({ variant: "not-found" as const, message: 'Run "acme.unknown" not found.' }),
    );

    const { code, errors } = await runEnterPhase("unknown", "phase-01");

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("not found");
  });

  it("two same-short-name runs in different namespaces resolve independently", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    const { readAgentBinding } = vi.mocked(await import("../../../src/app/agentBinding.js"));
    readAgentBinding.mockResolvedValue(Result.fail("no binding"));

    // First call: inside namespace "alpha"
    loadConfig.mockReturnValue(Result.succeed(makeConfig("alpha")));
    const infoAlpha = makeRunInfo("alpha", "fixbug");
    resolveRunRef.mockReturnValue(
      Result.succeed({
        namespace: "alpha",
        shortName: "fixbug",
        info: infoAlpha,
        crossProject: false,
      }),
    );
    const { code: codeA, errors: errA } = await runEnterPhase("fixbug", "phase-01");

    // Second call: inside namespace "beta"
    loadConfig.mockReturnValue(Result.succeed(makeConfig("beta")));
    const infoBeta = makeRunInfo("beta", "fixbug");
    resolveRunRef.mockReturnValue(
      Result.succeed({
        namespace: "beta",
        shortName: "fixbug",
        info: infoBeta,
        crossProject: false,
      }),
    );
    const { code: codeB, errors: errB } = await runEnterPhase("fixbug", "phase-01");

    // Both fail at binding but with their respective qualified names
    expect(codeA).toBe(1);
    expect(errA.join("\n")).toContain("alpha.fixbug");
    expect(codeB).toBe(1);
    expect(errB.join("\n")).toContain("beta.fixbug");
  });
});
