import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { writeFinalReport } from "../../src/app/finalReport.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";

const stateRoot = "/fake-state";
const shortName = "test-run";
const runPath = `${stateRoot}/runs/${shortName}`;
const finalBranch = "feature/test-run--phase-02" as BranchName;
const now = "2026-06-12T12:00:00.000Z";

function makePhaseStatus(overrides: Partial<PhaseStatus> = {}): PhaseStatus {
  return {
    version: 1,
    phaseId: "phase-01",
    phaseIndex: 0,
    state: "review_open",
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: "ai/test-run--phase-01" as BranchName,
    createdAt: now,
    updatedAt: now,
    claudeSessionId: undefined,
    commitHash: undefined,
    ...overrides,
  };
}

function makeInfo(overrides: Partial<RunReviewInfo> = {}): RunReviewInfo {
  return {
    namespace: "test-project",
    shortName,
    runId: "test-run-999",
    runState: "review_open",
    branch: "feature/test-run",
    runTitle: "My Run Title",
    finalPhaseBranch: finalBranch,
    stateRoot,
    runPath,
    finalPhaseId: "phase-02",
    finalPhaseTitle: "Final Phase",
    worktreePath: "/fake/wt",
    claudeSessionId: undefined as ClaudeSessionId | undefined,
    gateProfileId: "full",
    phaseStatuses: [
      makePhaseStatus({ phaseId: "phase-01" }),
      makePhaseStatus({ phaseId: "phase-02" }),
    ],
    planPhases: [
      { id: "phase-01", title: "First Phase" },
      { id: "phase-02", title: "Final Phase" },
    ],
    updatedAt: now,
    stoppedReason: undefined,
    lastError: undefined,
    ...overrides,
  };
}

describe("writeFinalReport", () => {
  it("renders the verified surfaces from the phases' gate-attribution records", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      `${runPath}/phase-01/gate-attribution.json`,
      JSON.stringify({
        phase: "phase-01",
        steps: [{ command: "pnpm format", surface: "local", result: "pass" }],
      }),
    );
    fs.impl.setFile(
      `${runPath}/phase-02/gate-attribution.json`,
      JSON.stringify({
        phase: "phase-02",
        steps: [{ command: "pnpm build", surface: "product", result: "pass" }],
      }),
    );

    await Effect.runPromise(writeFinalReport(makeInfo()).pipe(Effect.provide(fs.layer)));

    const report = fs.impl.getFile(`${runPath}/final-report.md`);
    expect(report).toBeDefined();
    expect(report).toContain("**Surfaces Verified**: local, product");
  });

  it("renders an explicit empty state when no attribution records exist", async () => {
    const fs = makeFakeFileSystem();

    await Effect.runPromise(writeFinalReport(makeInfo()).pipe(Effect.provide(fs.layer)));

    const report = fs.impl.getFile(`${runPath}/final-report.md`);
    expect(report).toBeDefined();
    expect(report).toContain("**Surfaces Verified**: (none)");
  });
});
