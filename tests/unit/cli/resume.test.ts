import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Either } from "effect";
import type { BranchName } from "../../../src/domain/branded.js";
import type { RunReviewInfo } from "../../../src/domain/runReviewInfo.js";
import type { PhaseState } from "../../../src/domain/state.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";
import type { PhaseStatus } from "../../../src/schemas/status.js";

vi.mock("../../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../../src/app/loadTelemetryConfig.js", () => ({ loadTelemetryConfig: vi.fn() }));
vi.mock("../../../src/app/resolveRunRef.js", () => ({ resolveRunRef: vi.fn() }));
vi.mock("../../../src/app/resume.js", () => ({ inspectResumeFromInfo: vi.fn() }));
vi.mock("../../../src/app/executePlan.js", () => ({ executePlan: vi.fn() }));
vi.mock("../../../src/app/lock.js", () => ({
  withRunLock: vi.fn((_key: string, e: unknown) => e),
}));
vi.mock("../../../src/app/loadRouting.js", () => ({
  loadModelRouting: vi.fn(),
  loadProviderConfig: vi.fn(),
}));
vi.mock("../../../src/cli/commands/runLayers.js", async () => {
  const { Layer } = await import("effect");
  return {
    provideRunLayers: vi.fn((effect: unknown) => effect),
    buildSystemTelemetryLayer: vi.fn(),
    exitCodeForError: vi.fn(() => 1),
    makeRepoRootedFileSystemLayer: vi.fn(() => Layer.empty),
  };
});
vi.mock("../../../src/cli/interruptHandler.js", () => ({
  setRunInterruptContext: vi.fn(),
  clearRunInterruptContext: vi.fn(),
}));
vi.mock("../../../src/infra/fs.js", async () => {
  const { Layer } = await import("effect");
  return { NodeFileSystemLayer: Layer.empty };
});
vi.mock("../../../src/ports/systemTelemetry.js", () => ({
  NoopSystemTelemetryLayer: {},
  SystemTelemetry: {},
}));

function makeOutput() {
  const lines: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    out: {
      log: (m: string) => lines.push(m),
      warn: (m: string) => warnings.push(m),
      error: (m: string) => errors.push(m),
    },
    lines,
    warnings,
    errors,
  };
}

function makeConfig(stateRoot: string): ResolvedConfig {
  return {
    raw: { gateProfiles: { full: {} } } as never,
    namespace: "test-ns",
    stateRoot,
    repoRoot: stateRoot,
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
    complianceReview: { enabled: false, model: "claude-sonnet-5", effort: "medium" },
    codeReview: { model: "claude-opus-5-5", effort: "high" },
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

function makePhaseStatus(state: PhaseState, index = 0): PhaseStatus {
  const now = new Date().toISOString();
  return {
    version: 1,
    phaseId: `phase-0${index + 1}`,
    phaseIndex: index,
    state,
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: `ai/my-run--phase-0${index + 1}` as BranchName,
    createdAt: now,
    updatedAt: now,
  };
}

function makeReviewOpenRefusal() {
  return {
    reason: "review_open" as const,
    message: "Run is already in review-open state.",
  };
}

describe("runResume — review_open early branch recap", () => {
  let stateRoot: string;
  let runPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    stateRoot = mkdtempSync(join(tmpdir(), "phax-resume-recap-"));
    runPath = join(stateRoot, "runs", "test-ns.my-run");
    mkdirSync(runPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  async function setupMocks(phaseStatuses: PhaseStatus[]) {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    const { loadTelemetryConfig } = vi.mocked(
      await import("../../../src/app/loadTelemetryConfig.js"),
    );
    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    const { inspectResumeFromInfo } = vi.mocked(await import("../../../src/app/resume.js"));

    loadConfig.mockReturnValue(Either.right(makeConfig(stateRoot)));
    loadTelemetryConfig.mockReturnValue(Either.right({ enabled: false }));

    const info: RunReviewInfo = {
      namespace: "test-ns",
      shortName: "my-run",
      runId: "run-123",
      runState: "review_open",
      branch: "ai/my-run",
      runTitle: "My Run",
      finalPhaseBranch: "ai/my-run--phase-01" as BranchName,
      stateRoot,
      runPath,
      finalPhaseId: "phase-01",
      finalPhaseTitle: "Phase 01",
      worktreePath: join(stateRoot, "worktrees", "test-ns.my-run", "phase-01"),
      claudeSessionId: undefined,
      gateProfileId: "full",
      phaseStatuses,
      planPhases: [{ id: "phase-01", title: "Phase 01" }],
      updatedAt: new Date().toISOString(),
      stoppedReason: undefined,
      lastError: undefined,
    };

    resolveRunRef.mockReturnValue(
      Either.right({ namespace: "test-ns", shortName: "my-run", info, crossProject: false }),
    );
    inspectResumeFromInfo.mockReturnValue(Either.left(makeReviewOpenRefusal()));
  }

  it("shows the committed-phase count in the recap headline", async () => {
    await setupMocks([makePhaseStatus("committed", 0), makePhaseStatus("review_open", 1)]);

    const { runResume } = await import("../../../src/cli/commands/resume.js");
    const { out, warnings } = makeOutput();
    const code = await runResume("my-run", {}, out);

    expect(code).toBe(0);
    const recap = warnings.join("\n");
    expect(recap).toContain("2 phase(s) complete");
  });

  it("excludes failed and skipped phases from the phase count", async () => {
    await setupMocks([
      makePhaseStatus("committed", 0),
      makePhaseStatus("failed", 1),
      makePhaseStatus("skipped", 2),
    ]);

    const { runResume } = await import("../../../src/cli/commands/resume.js");
    const { out, warnings } = makeOutput();
    await runResume("my-run", {}, out);

    const recap = warnings.join("\n");
    expect(recap).toContain("1 phase(s) complete");
  });

  it("shows the PR URL and omits publish-pr suggestion when publication.json has a URL", async () => {
    await setupMocks([makePhaseStatus("committed", 0)]);

    writeFileSync(
      join(runPath, "publication.json"),
      JSON.stringify({
        version: 1,
        enabled: true,
        provider: "github",
        remote: "origin",
        branch: "ai/my-run",
        pushStatus: "pushed",
        prStatus: "created",
        pullRequestUrl: "https://github.com/acme/repo/pull/42",
        createdAt: new Date().toISOString(),
      }),
    );

    const { runResume } = await import("../../../src/cli/commands/resume.js");
    const { out, warnings } = makeOutput();
    await runResume("my-run", {}, out);

    const recap = warnings.join("\n");
    expect(recap).toContain("https://github.com/acme/repo/pull/42");
    expect(recap).not.toContain("phax publish-pr");
  });

  it("shows publish-pr when no publication.json exists", async () => {
    await setupMocks([makePhaseStatus("committed", 0)]);

    const { runResume } = await import("../../../src/cli/commands/resume.js");
    const { out, warnings } = makeOutput();
    await runResume("my-run", {}, out);

    const recap = warnings.join("\n");
    expect(recap).toContain("phax publish-pr");
  });

  it("shows publish-pr when publication.json has no pullRequestUrl", async () => {
    await setupMocks([makePhaseStatus("committed", 0)]);

    writeFileSync(
      join(runPath, "publication.json"),
      JSON.stringify({
        version: 1,
        enabled: true,
        provider: "github",
        remote: "origin",
        branch: "ai/my-run",
        pushStatus: "not_attempted",
        prStatus: "not_attempted",
        createdAt: new Date().toISOString(),
      }),
    );

    const { runResume } = await import("../../../src/cli/commands/resume.js");
    const { out, warnings } = makeOutput();
    await runResume("my-run", {}, out);

    const recap = warnings.join("\n");
    expect(recap).toContain("phax publish-pr");
  });
});
