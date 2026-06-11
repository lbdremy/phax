import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { openFinalReview } from "../../src/app/finalReview.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunReviewInfo } from "../../src/app/resolveRunInfo.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import type { BranchName } from "../../src/domain/branded.js";
import { encodePhaseFileReconciliation } from "../../src/schemas/reconciliation.js";

const stateRoot = "/fake-state";
const shortName = "my-run";
const runPath = `${stateRoot}/runs/${shortName}`;
const now = "2024-01-01T00:00:00.000Z";

const phaseStatus: PhaseStatus = {
  version: 1,
  phaseId: "phase-01",
  phaseIndex: 0,
  state: "committed",
  model: "claude-sonnet-4-6",
  effort: "low",
  branchName: "feature/my-run--phase-01" as BranchName,
  createdAt: now,
  updatedAt: now,
  worktreePath: "/fake/worktrees/my-run/phase-01",
  claudeSessionId: "sess-abc123",
};

const runReviewInfo: RunReviewInfo = {
  shortName,
  runId: "my-run-1234567890",
  runState: "running",
  branch: "feature/my-run",
  finalPhaseBranch: "feature/my-run--phase-01" as BranchName,
  stateRoot,
  runPath,
  finalPhaseId: "phase-01",
  finalPhaseTitle: "First Phase",
  worktreePath: "/fake/worktrees/my-run/phase-01",
  claudeSessionId: "sess-abc123",
  gateProfileId: "fast",
  phaseStatuses: [phaseStatus],
  planPhases: [{ id: "phase-01", title: "First Phase" }],
  updatedAt: now,
  stoppedReason: undefined,
  lastError: undefined,
};

function makeRunStatusJson(state: string): string {
  return JSON.stringify({
    version: 1,
    shortName,
    runId: "my-run-1234567890",
    state,
    createdAt: now,
    updatedAt: now,
    phasesCount: 1,
  });
}

function makePhaseStatusJson(state: string): string {
  return JSON.stringify({ ...phaseStatus, state });
}

function makePhaseReconciliationJson(): string {
  return JSON.stringify(
    encodePhaseFileReconciliation({
      phaseId: "phase-01",
      createdAsPlanned: [],
      editedAsPlanned: [],
      missingPlannedCreate: [],
      missingPlannedEdit: [],
      unplannedCreated: [],
      unplannedEdited: [],
      optionalTouched: [],
      deletions: [],
      renames: [],
      hasDeviations: false,
    }),
  );
}

function setupLayers() {
  const fs = makeFakeFileSystem();
  const layers = Layer.mergeAll(
    fs.layer,
    makeFakeGit().layer,
    makeFakeShell().layer,
    NoopSystemTelemetryLayer,
  );
  return { impl: fs.impl, layers };
}

function setupRequiredFiles(impl: ReturnType<typeof makeFakeFileSystem>["impl"], state: string) {
  impl.setFile(`${runPath}/run-status.json`, makeRunStatusJson(state));
  impl.setFile(`${runPath}/phase-01/status.json`, makePhaseStatusJson("committed"));
  impl.setFile(`${runPath}/phase-01/file-reconciliation.json`, makePhaseReconciliationJson());
  impl.setFile(
    `${runPath}/phase-01/file-reconciliation.md`,
    "## File Reconciliation\n\nNo deviations.",
  );
  impl.setFile(`${runPath}/phase-01/phase-handoff.md`, "## Phase Handoff\n\nAll done.");
}

describe("openFinalReview", () => {
  it("writes review-handoff.md to the run path", async () => {
    const { impl, layers } = setupLayers();
    setupRequiredFiles(impl, "running");

    await Effect.runPromise(openFinalReview(runReviewInfo).pipe(Effect.provide(layers)));

    const handoff = impl.getFile(`${runPath}/review-handoff.md`);
    expect(handoff).toBeDefined();
  });

  it("review-handoff.md contains run id, short name, and branch", async () => {
    const { impl, layers } = setupLayers();
    setupRequiredFiles(impl, "running");

    await Effect.runPromise(openFinalReview(runReviewInfo).pipe(Effect.provide(layers)));

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain("my-run");
    expect(handoff).toContain("my-run-1234567890");
    expect(handoff).toContain("feature/my-run");
  });

  it("review-handoff.md does NOT contain the entry commands (they are in final-report.md)", async () => {
    const { impl, layers } = setupLayers();
    setupRequiredFiles(impl, "running");

    await Effect.runPromise(openFinalReview(runReviewInfo).pipe(Effect.provide(layers)));

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).not.toContain("phax enter my-run");
    expect(handoff).not.toContain("phax shell my-run");
    expect(handoff).not.toContain("phax archive my-run");
  });

  it("final-report.md contains the entry commands", async () => {
    const { impl, layers } = setupLayers();
    setupRequiredFiles(impl, "running");

    await Effect.runPromise(openFinalReview(runReviewInfo).pipe(Effect.provide(layers)));

    const report = impl.getFile(`${runPath}/final-report.md`)!;
    expect(report).toBeDefined();
    expect(report).toContain("phax enter my-run");
    expect(report).toContain("phax shell my-run");
    expect(report).toContain("phax path my-run");
    expect(report).toContain("phax archive my-run");
  });

  it("final-report.md contains the session id and resume snippet", async () => {
    const { impl, layers } = setupLayers();
    setupRequiredFiles(impl, "running");

    await Effect.runPromise(openFinalReview(runReviewInfo).pipe(Effect.provide(layers)));

    const report = impl.getFile(`${runPath}/final-report.md`)!;
    expect(report).toContain("sess-abc123");
    expect(report).toContain("claude --resume sess-abc123");
  });

  it("transitions run-status.json to review_open", async () => {
    const { impl, layers } = setupLayers();
    setupRequiredFiles(impl, "running");

    await Effect.runPromise(openFinalReview(runReviewInfo).pipe(Effect.provide(layers)));

    const raw = impl.getFile(`${runPath}/run-status.json`);
    const parsed = JSON.parse(raw!) as { state: string };
    expect(parsed.state).toBe("review_open");
  });

  it("transitions phase status to review_open", async () => {
    const { impl, layers } = setupLayers();
    setupRequiredFiles(impl, "running");

    await Effect.runPromise(openFinalReview(runReviewInfo).pipe(Effect.provide(layers)));

    const raw = impl.getFile(`${runPath}/phase-01/status.json`);
    const parsed = JSON.parse(raw!) as { state: string };
    expect(parsed.state).toBe("review_open");
  });

  it("final-report.md includes the Conductor handoff section", async () => {
    const { impl, layers } = setupLayers();
    setupRequiredFiles(impl, "running");

    await Effect.runPromise(openFinalReview(runReviewInfo).pipe(Effect.provide(layers)));

    const report = impl.getFile(`${runPath}/final-report.md`)!;
    expect(report).toContain("Conductor Handoff");
    expect(report).toContain("feature/my-run");
    expect(report).toContain("/fake/worktrees/my-run/phase-01");
  });

  it("review-handoff.md contains global file reconciliation section", async () => {
    const { impl, layers } = setupLayers();
    setupRequiredFiles(impl, "running");

    await Effect.runPromise(openFinalReview(runReviewInfo).pipe(Effect.provide(layers)));

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toContain("Global File Reconciliation");
  });

  it("matches the review-handoff.md snapshot", async () => {
    const { impl, layers } = setupLayers();
    setupRequiredFiles(impl, "running");

    await Effect.runPromise(openFinalReview(runReviewInfo).pipe(Effect.provide(layers)));

    const handoff = impl.getFile(`${runPath}/review-handoff.md`)!;
    expect(handoff).toMatchSnapshot();
  });

  it("handles missing run-status.json gracefully (no crash)", async () => {
    const { impl, layers } = setupLayers();
    impl.setFile(`${runPath}/phase-01/status.json`, makePhaseStatusJson("committed"));

    await Effect.runPromise(
      Effect.ignore(openFinalReview(runReviewInfo).pipe(Effect.provide(layers))),
    );
  });
});
