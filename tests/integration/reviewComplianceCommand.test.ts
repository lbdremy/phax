import { Effect, Either, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { reviewCompliance } from "../../src/app/reviewCompliance.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName, ClaudeSessionId } from "../../src/domain/branded.js";
import type { ResolvedComplianceReviewConfig } from "../../src/schemas/phaxConfig.js";
import type { RoutingResolution } from "../../src/domain/routing/types.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";

// These tests exercise the CLI command logic by calling reviewCompliance directly
// (the same use case the command delegates to) with fake layers, then verifying
// the result shape the command renders from.

const stateRoot = "/fake-state";
const shortName = "my-run";
const runPath = `${stateRoot}/runs/${shortName}`;
const worktreePath = "/fake/worktrees/my-run--phase-01";
const phaxContextPath = `${worktreePath}/.phax-context`;

function makeInfo(overrides: Partial<RunReviewInfo> = {}): RunReviewInfo {
  return {
    namespace: "test-project",
    shortName,
    runId: "my-run-001",
    runState: "review_open",
    branch: "feature/my-run",
    runTitle: "My Run",
    finalPhaseBranch: "feature/my-run--phase-01" as BranchName,
    stateRoot,
    runPath,
    finalPhaseId: "phase-01",
    finalPhaseTitle: "Phase 01",
    worktreePath,
    claudeSessionId: undefined,
    gateProfileId: "full",
    phaseStatuses: [],
    planPhases: [{ id: "phase-01", title: "Phase 01" }],
    updatedAt: "2026-06-22T12:00:00.000Z",
    stoppedReason: undefined,
    lastError: undefined,
    ...overrides,
  };
}

const enabledConfig: ResolvedComplianceReviewConfig = {
  enabled: true,
  model: "claude-sonnet-4-6",
  effort: "medium",
};

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
    filesystem: { allowRead: [], allowWrite: [], allowWriteProtected: [] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
  } satisfies ResolvedSecurityConfig,
};

const fakeSessionResult = {
  sessionId: "sess-cmd-test" as ClaudeSessionId,
  outputPath: `${runPath}/compliance-review.session.jsonl`,
  finalText: "Review complete.",
};

const validJson = JSON.stringify({
  version: 1,
  verdict: "conformant-with-deviations",
  summary: "Minor deviations found.",
  perPhase: [{ phaseId: "phase-01", verdict: "conformant-with-deviations", findings: [] }],
  attentionPoints: [],
  pointers: [],
});

function setupLayers(
  backend: ReturnType<typeof makeFakeBackend>,
  fs: ReturnType<typeof makeFakeFileSystem>,
) {
  return Layer.mergeAll(backend.layer, fs.layer, NoopSystemTelemetryLayer);
}

describe("review-compliance command (use-case layer)", () => {
  it("returns disabled when config is not enabled", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), disabledConfig, fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(setupLayers(backend, fs)),
      ),
    );

    expect(result.kind).toBe("disabled");
    // Command renders the not-enabled error and exits 1
  });

  it("returns generated with verdict when backend writes valid artifacts", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/plan.md`, "# Plan\n");
    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, "# Reconciliation\n");
    backend.impl.addRunResponse(fakeSessionResult);
    fs.impl.setFile(`${phaxContextPath}/compliance-review.md`, "# Review\n\nAll good.\n");
    fs.impl.setFile(`${phaxContextPath}/compliance-review.json`, validJson);

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig, fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(setupLayers(backend, fs)),
      ),
    );

    // Command renders verdict + artifact path, exits 0
    expect(result.kind).toBe("generated");
    expect(result.verdict).toBe("conformant-with-deviations");
    expect(result.mdArtifactPath).toBe(`${runPath}/compliance-review.md`);
    expect(result.structuredVerdictMissing).toBeUndefined();
  });

  it("returns failed when plan.md is absent", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, "# Reconciliation\n");
    // No plan.md

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig, fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(setupLayers(backend, fs)),
      ),
    );

    // Command renders failure reason + retry hint, exits 1
    expect(result.kind).toBe("failed");
    expect(result.failureReason).toBeDefined();
    expect(backend.impl.runCalls).toHaveLength(0);
  });

  it("returns generated with unknown verdict when json is missing", async () => {
    const fs = makeFakeFileSystem();
    const backend = makeFakeBackend();

    fs.impl.setFile(`${runPath}/plan.md`, "# Plan\n");
    fs.impl.setFile(`${runPath}/global-file-reconciliation.md`, "# Reconciliation\n");
    backend.impl.addRunResponse(fakeSessionResult);
    fs.impl.setFile(`${phaxContextPath}/compliance-review.md`, "# Review\n\nSome prose.\n");
    // No json artifact

    const result = await Effect.runPromise(
      reviewCompliance(makeInfo(), enabledConfig, fakeResolution, fakeSecurity, {}).pipe(
        Effect.provide(setupLayers(backend, fs)),
      ),
    );

    // Command renders "unknown" verdict, exits 0 (advisory)
    expect(result.kind).toBe("generated");
    expect(result.verdict).toBe("unknown");
    expect(result.structuredVerdictMissing).toBe(true);
  });
});
