import { Effect, Layer } from "effect";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeFinalReport } from "../../src/app/finalReport.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { encodeGateAttribution } from "../../src/schemas/gateAttribution.js";
import type { RunReviewInfo } from "../../src/app/resolveRunInfo.js";
import type { BranchName } from "../../src/domain/branded.js";
import type { PhaseStatus } from "../../src/schemas/status.js";

const RUN_PATH = "/fake-state/runs/my-run";
const NOW = "2024-01-01T00:00:00.000Z";

function makePhaseStatus(phaseId: string, phaseIndex: number): PhaseStatus {
  return {
    version: 1,
    phaseId,
    phaseIndex,
    state: "committed",
    model: "claude-sonnet-4-6",
    effort: "medium",
    branchName: `feature/my-run--${phaseId}` as BranchName,
    createdAt: NOW,
    updatedAt: NOW,
    worktreePath: `/fake/worktrees/my-run/${phaseId}`,
    claudeSessionId: undefined,
  };
}

function makeInfo(phaseIds: string[]): RunReviewInfo {
  const phaseStatuses = phaseIds.map((id, i) => makePhaseStatus(id, i));
  return {
    namespace: "test-project",
    shortName: "my-run",
    runId: "my-run-1234567890",
    runState: "review_open",
    branch: "feature/my-run",
    runTitle: undefined,
    finalPhaseBranch: `feature/my-run--${phaseIds.at(-1) ?? "phase-01"}` as BranchName,
    stateRoot: "/fake-state",
    runPath: RUN_PATH,
    finalPhaseId: phaseIds.at(-1) ?? "phase-01",
    finalPhaseTitle: "Final Phase",
    worktreePath: "/fake/worktrees/my-run/phase-01",
    claudeSessionId: undefined,
    gateProfileId: "standard",
    phaseStatuses,
    planPhases: phaseIds.map((id) => ({ id, title: id })),
    updatedAt: NOW,
    stoppedReason: undefined,
    lastError: undefined,
  };
}

function makeAttributionJson(
  phase: string,
  steps: { command: string; surface: string; result: "pass" | "fail" }[],
): string {
  return JSON.stringify(encodeGateAttribution({ phase, steps }));
}

async function runWriteFinalReport(
  info: RunReviewInfo,
  fs: ReturnType<typeof makeFakeFileSystem>,
): Promise<string> {
  await Effect.runPromise(writeFinalReport(info).pipe(Effect.provide(fs.layer)));
  return fs.impl.getFile(join(RUN_PATH, "final-report.md")) ?? "";
}

describe("writeFinalReport — verified surfaces", () => {
  it("renders verified surfaces from passing steps in the run summary", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttributionJson("phase-01", [
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "pnpm build", surface: "product", result: "pass" },
      ]),
    );

    const content = await runWriteFinalReport(makeInfo(["phase-01"]), fs);
    expect(content).toContain("**Surfaces Verified**: local, product");
  });

  it("renders surfaces from multiple phases deduplicated and sorted", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttributionJson("phase-01", [{ command: "pnpm test", surface: "local", result: "pass" }]),
    );
    fs.impl.setFile(
      join(RUN_PATH, "phase-02", "gate-attribution.json"),
      makeAttributionJson("phase-02", [
        { command: "pnpm build", surface: "product", result: "pass" },
        { command: "pnpm test", surface: "local", result: "pass" },
      ]),
    );

    const content = await runWriteFinalReport(makeInfo(["phase-01", "phase-02"]), fs);
    expect(content).toContain("**Surfaces Verified**: local, product");
  });

  it("renders (none) when no attribution records exist", async () => {
    const fs = makeFakeFileSystem();
    const content = await runWriteFinalReport(makeInfo(["phase-01"]), fs);
    expect(content).toContain("**Surfaces Verified**: (none)");
  });

  it("renders (none) when all steps failed", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttributionJson("phase-01", [{ command: "pnpm test", surface: "local", result: "fail" }]),
    );

    const content = await runWriteFinalReport(makeInfo(["phase-01"]), fs);
    expect(content).toContain("**Surfaces Verified**: (none)");
  });

  it("excludes surfaces where all steps failed even if another surface passed", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttributionJson("phase-01", [
        { command: "pnpm test", surface: "local", result: "fail" },
        { command: "pnpm build", surface: "product", result: "pass" },
      ]),
    );

    const content = await runWriteFinalReport(makeInfo(["phase-01"]), fs);
    expect(content).toContain("**Surfaces Verified**: product");
    expect(content).not.toContain("local");
  });

  it("surfaces verified line appears in the Run Summary section", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttributionJson("phase-01", [{ command: "pnpm test", surface: "local", result: "pass" }]),
    );

    const content = await runWriteFinalReport(makeInfo(["phase-01"]), fs);
    const runSummaryStart = content.indexOf("## Run Summary");
    const phaseSectionStart = content.indexOf("## Phase Details");
    const surfaceLinePos = content.indexOf("**Surfaces Verified**");

    expect(runSummaryStart).toBeGreaterThan(-1);
    expect(surfaceLinePos).toBeGreaterThan(runSummaryStart);
    expect(surfaceLinePos).toBeLessThan(phaseSectionStart);
  });
});
