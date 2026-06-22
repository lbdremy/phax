import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect, Either } from "effect";
import { runPublishPr } from "../../../src/cli/commands/publishPr.js";
import type { RunReviewInfo } from "../../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../../src/domain/branded.js";
import type { ResolvedConfig } from "../../../src/schemas/phaxConfig.js";

const FAKE_SHORT_NAME = "my-run";
const FAKE_PR_URL = "https://github.com/org/repo/pull/42";

vi.mock("../../../src/app/loadConfig.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../../src/app/resolveRunRef.js", () => ({
  resolveRunRef: vi.fn(),
}));

vi.mock("../../../src/app/publishRun.js", () => ({
  publishRun: vi.fn(),
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

function makeConfig(publishEnabled: boolean): ResolvedConfig {
  return {
    raw: {} as ResolvedConfig["raw"],
    namespace: "test-project",
    stateRoot: "/fake-state",
    repoRoot: "/fake-repo",
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    security: { mode: "secure", enforcedGates: [], allowedPaths: [], blockedCommands: [] },
    publish: {
      enabled: publishEnabled,
      remote: "origin",
      provider: "github",
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: { enabled: false, model: "claude-sonnet-4-6", effort: "medium" },
  };
}

function makeInfo(): RunReviewInfo {
  return {
    namespace: "test-project",
    shortName: FAKE_SHORT_NAME,
    runId: "run-999",
    runState: "review_open",
    branch: "feature/my-run",
    runTitle: "My Run",
    finalPhaseBranch: "feature/my-run--phase-01" as BranchName,
    stateRoot: "/fake-state",
    runPath: `/fake-state/runs/${FAKE_SHORT_NAME}`,
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

describe("runPublishPr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 1 and error when config load fails", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.left({ message: "no phax.json" }));

    const { out, errors } = makeOutput();
    const code = await runPublishPr(FAKE_SHORT_NAME, {}, out);
    expect(code).toBe(1);
    expect(errors.join("")).toContain("Config error");
  });

  it("returns 1 and error when publish is disabled in config", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(false)));

    const { out, errors } = makeOutput();
    const code = await runPublishPr(FAKE_SHORT_NAME, {}, out);
    expect(code).toBe(1);
    expect(errors.join("")).toContain("publish is not enabled");
  });

  it("returns 1 when short name is invalid", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(true)));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    resolveRunRef.mockReturnValue(
      Either.left({
        message: '"INVALID NAME!" is not a valid run short name.',
        variant: "not-found" as const,
      }),
    );

    const { out, errors } = makeOutput();
    const code = await runPublishPr("INVALID NAME!", {}, out);
    expect(code).toBe(1);
    expect(errors.join("")).toContain("not a valid run short name");
  });

  it("returns 1 when run cannot be resolved", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(true)));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    resolveRunRef.mockReturnValue(Either.left({ message: "run not found", variant: "not-found" }));

    const { out, errors } = makeOutput();
    const code = await runPublishPr(FAKE_SHORT_NAME, {}, out);
    expect(code).toBe(1);
    expect(errors.join("")).toContain("not found");
  });

  it("returns 1 when run is not in review_open state", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(true)));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    resolveRunRef.mockReturnValue(
      Either.right({
        namespace: "test-project",
        shortName: FAKE_SHORT_NAME,
        info: { ...makeInfo(), runState: "running" },
        crossProject: false,
      }),
    );

    const { out, errors } = makeOutput();
    const code = await runPublishPr(FAKE_SHORT_NAME, {}, out);
    expect(code).toBe(1);
    expect(errors.join("")).toContain("review_open");
  });

  it("returns 0 and prints PR URL on successful publication", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(true)));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    resolveRunRef.mockReturnValue(
      Either.right({
        namespace: "test-project",
        shortName: FAKE_SHORT_NAME,
        info: makeInfo(),
        crossProject: false,
      }),
    );

    const { publishRun } = vi.mocked(await import("../../../src/app/publishRun.js"));
    publishRun.mockReturnValue(Effect.succeed({ kind: "published", prUrl: FAKE_PR_URL }));

    const { out, lines } = makeOutput();
    const code = await runPublishPr(FAKE_SHORT_NAME, {}, out);
    expect(code).toBe(0);
    expect(lines.join("")).toContain(FAKE_PR_URL);
  });

  it("returns 1 and prints failure reason + retry hint on failed publication", async () => {
    const { loadConfig } = vi.mocked(await import("../../../src/app/loadConfig.js"));
    loadConfig.mockReturnValue(Either.right(makeConfig(true)));

    const { resolveRunRef } = vi.mocked(await import("../../../src/app/resolveRunRef.js"));
    resolveRunRef.mockReturnValue(
      Either.right({
        namespace: "test-project",
        shortName: FAKE_SHORT_NAME,
        info: makeInfo(),
        crossProject: false,
      }),
    );

    const { publishRun } = vi.mocked(await import("../../../src/app/publishRun.js"));
    publishRun.mockReturnValue(
      Effect.succeed({ kind: "failed", failureReason: "gh not available" }),
    );

    const { out, errors } = makeOutput();
    const code = await runPublishPr(FAKE_SHORT_NAME, {}, out);
    expect(code).toBe(1);
    const errText = errors.join("");
    expect(errText).toContain("gh not available");
    expect(errText).toContain(`phax publish-pr`);
  });
});
