import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { reviewCompliance } from "../../src/app/reviewCompliance.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { ResolvedComplianceReviewConfig } from "../../src/schemas/phaxConfig.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";

const stateRoot = "/fake-state";
const shortName = "test-run";
const runPath = `${stateRoot}/runs/${shortName}`;
const worktreePath = "/fake/worktrees/test-run--phase-02";
const phaxContextPath = `${worktreePath}/.phax-context`;

function makeInfo(overrides: Partial<RunReviewInfo> = {}): RunReviewInfo {
  return {
    namespace: "test-project",
    shortName,
    runId: "test-run-999",
    runState: "review_open",
    branch: "feature/test-run",
    runTitle: "My Run Title",
    finalPhaseBranch: "feature/test-run--phase-02" as BranchName,
    stateRoot,
    runPath,
    finalPhaseId: "phase-02",
    finalPhaseTitle: "Final Phase",
    worktreePath,
    claudeSessionId: undefined,
    gateProfileId: "full",
    phaseStatuses: [],
    planPhases: [
      { id: "phase-01", title: "First Phase" },
      { id: "phase-02", title: "Final Phase" },
    ],
    updatedAt: "2026-06-22T12:00:00.000Z",
    stoppedReason: undefined,
    lastError: undefined,
    ...overrides,
  };
}

function enabledConfig(
  overrides: Partial<ResolvedComplianceReviewConfig> = {},
): ResolvedComplianceReviewConfig {
  return {
    enabled: true,
    model: "claude-sonnet-4-6",
    effort: "medium",
    ...overrides,
  };
}

const disabledConfig: ResolvedComplianceReviewConfig = {
  enabled: false,
  model: "claude-sonnet-4-6",
  effort: "medium",
};

const fakeResolution: RoutingResolution = {
  requested: { model: "claude-sonnet-4-6", family: "claude-sonnet", effort: "medium" },
  normalizedTier: "standard",
  selected: {
    provider: "claude-code",
    family: "claude-sonnet",
    concreteModel: "claude-sonnet-4-6",
    thinking: "medium",
  },
  relationship: "exact",
  reason: "exact match",
};

const fakeSecurity = {
  mode: "secure" as const,
  config: {
    profile: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
  } satisfies ResolvedSecurityConfig,
};

const fakePlanMd = "# Plan\n\nThis is the plan.\n";
const fakeReconciliationMd = "# Global File Reconciliation\n\nAll files planned.\n";

const validComplianceJson = JSON.stringify({
  version: 1,
  verdict: "conformant",
  summary: "All phases conformed.",
  perPhase: [
    { phaseId: "phase-01", verdict: "conformant", findings: [] },
    { phaseId: "phase-02", verdict: "conformant", findings: [] },
  ],
  attentionPoints: [],
  pointers: [],
});

const fakeSessionResult = {
  sessionId: "sess-abc" as import("../../src/domain/branded.js").ClaudeSessionId,
  outputPath: `${runPath}/compliance-review.session.jsonl`,
  finalText: "Review complete.",
};

function setupLayers(
  backend: ReturnType<typeof makeFakeBackend>,
  fs: ReturnType<typeof makeFakeFileSystem>,
) {
  return Layer.mergeAll(backend.layer, fs.layer, NoopSystemTelemetryLayer);
}

describe("reviewCompliance", () => {
  it("returns disabled and invokes no agent when config.enabled is false", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();
    const layers = setupLayers(backend, fs);

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), disabledConfig, fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("disabled");
    expect(backend.impl.runCalls).toHaveLength(0);
  });

  it("happy path: writes durable md + json, returns generated with verdict", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/plan.md`, fakePlanMd);
    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, fakeReconciliationMd);
    backend.impl.addRunResponse(fakeSessionResult);

    // Pre-seed the agent's output files (simulating what the agent would write into .phax-context/)
    fs.impl.setFile(
      `${phaxContextPath}/compliance-review.md`,
      "# Compliance Review\n\nConformant.\n",
    );
    fs.impl.setFile(`${phaxContextPath}/compliance-review.json`, validComplianceJson);

    const layers = setupLayers(backend, fs);

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig(), fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("generated");
    expect(result.verdict).toBe("conformant");
    expect(result.review?.verdict).toBe("conformant");
    expect(result.structuredVerdictMissing).toBeUndefined();
    expect(result.mdArtifactPath).toBe(`${runPath}/compliance-review.md`);

    // Durable copies written into runPath
    expect(fs.impl.getFile(`${runPath}/compliance-review.md`)).toContain("Compliance Review");
    expect(fs.impl.getFile(`${runPath}/compliance-review.json`)).toContain("conformant");

    // Agent invoked fresh (runAgent, not resumeAgentSession)
    expect(backend.impl.runCalls).toHaveLength(1);
    expect(backend.impl.resumeCalls).toHaveLength(0);
  });

  it("returns failed when global-file-reconciliation.md is missing", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/plan.md`, fakePlanMd);
    // No reconciliation file

    const layers = setupLayers(backend, fs);

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig(), fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("failed");
    expect(result.failureReason).toMatch(/reconciliation/i);
    expect(backend.impl.runCalls).toHaveLength(0);
  });

  it("returns failed when plan.md is missing", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, fakeReconciliationMd);
    // No plan.md

    const layers = setupLayers(backend, fs);

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig(), fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("failed");
    expect(result.failureReason).toMatch(/plan/i);
    expect(backend.impl.runCalls).toHaveLength(0);
  });

  it("returns failed when agent does not write compliance-review.md", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/plan.md`, fakePlanMd);
    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, fakeReconciliationMd);
    backend.impl.addRunResponse(fakeSessionResult);
    // Agent writes nothing into .phax-context/

    const layers = setupLayers(backend, fs);

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig(), fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("failed");
    expect(result.failureReason).toMatch(/compliance-review\.md/i);
  });

  it("returns generated with verdict unknown when json is missing but md is present", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/plan.md`, fakePlanMd);
    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, fakeReconciliationMd);
    backend.impl.addRunResponse(fakeSessionResult);
    fs.impl.setFile(
      `${phaxContextPath}/compliance-review.md`,
      "# Compliance Review\n\nConformant.\n",
    );
    // No json file

    const layers = setupLayers(backend, fs);

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig(), fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("generated");
    expect(result.verdict).toBe("unknown");
    expect(result.structuredVerdictMissing).toBe(true);
    expect(result.mdArtifactPath).toBe(`${runPath}/compliance-review.md`);
    expect(fs.impl.getFile(`${runPath}/compliance-review.md`)).toBeDefined();
  });

  it("returns generated with verdict unknown when json is undecodable (bad enum)", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/plan.md`, fakePlanMd);
    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, fakeReconciliationMd);
    backend.impl.addRunResponse(fakeSessionResult);
    fs.impl.setFile(
      `${phaxContextPath}/compliance-review.md`,
      "# Compliance Review\n\nConformant.\n",
    );
    // JSON with invalid verdict
    fs.impl.setFile(
      `${phaxContextPath}/compliance-review.json`,
      JSON.stringify({ ...JSON.parse(validComplianceJson), verdict: "invalid-verdict" }),
    );

    const layers = setupLayers(backend, fs);

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig(), fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("generated");
    expect(result.verdict).toBe("unknown");
    expect(result.structuredVerdictMissing).toBe(true);
  });

  it("returns generated with verdict unknown when json has excess keys", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/plan.md`, fakePlanMd);
    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, fakeReconciliationMd);
    backend.impl.addRunResponse(fakeSessionResult);
    fs.impl.setFile(
      `${phaxContextPath}/compliance-review.md`,
      "# Compliance Review\n\nConformant.\n",
    );
    // JSON with excess key
    const withExcess = { ...JSON.parse(validComplianceJson), bogusKey: "not allowed" };
    fs.impl.setFile(`${phaxContextPath}/compliance-review.json`, JSON.stringify(withExcess));

    const layers = setupLayers(backend, fs);

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig(), fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("generated");
    expect(result.verdict).toBe("unknown");
    expect(result.structuredVerdictMissing).toBe(true);
  });

  it("returns failed when agent invocation fails, does not throw", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/plan.md`, fakePlanMd);
    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, fakeReconciliationMd);
    backend.impl.failRunWithRateLimit(0, { kind: "rate_limit" });

    const layers = setupLayers(backend, fs);

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig(), fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(layers),
      ),
    );

    expect(result.kind).toBe("failed");
    expect(result.failureReason).toMatch(/agent invocation failed/i);
  });

  it("uses fresh runAgent call (not resumeAgentSession)", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/plan.md`, fakePlanMd);
    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, fakeReconciliationMd);
    backend.impl.addRunResponse(fakeSessionResult);
    fs.impl.setFile(
      `${phaxContextPath}/compliance-review.md`,
      "# Compliance Review\n\nConformant.\n",
    );
    fs.impl.setFile(`${phaxContextPath}/compliance-review.json`, validComplianceJson);

    const layers = setupLayers(backend, fs);

    await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig(), fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(layers),
      ),
    );

    expect(backend.impl.runCalls).toHaveLength(1);
    expect(backend.impl.resumeCalls).toHaveLength(0);
  });
});
