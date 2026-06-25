import { Either } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeShortName } from "../../src/domain/branded.js";
import { resolveRun } from "../../src/app/resolveRunInfo.js";
import { inspectResume } from "../../src/app/resume.js";
import { runKey } from "../../src/domain/runRef.js";

const NAMESPACE = "test-project";
const SHORT_NAME = Either.getOrThrow(decodeShortName("my-run"));
const NOW = "2026-06-25T00:00:00.000Z";

const RAW_PLAN = {
  version: 1,
  run: {
    shortName: "my-run",
    title: "My Run",
    branch: "ai/my-run",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "First Phase",
      model: "claude-sonnet-4-6",
      effort: "low",
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
    {
      id: "phase-02",
      title: "Second Phase",
      model: "claude-sonnet-4-6",
      effort: "low",
      planMarkdownAnchor: "#phase-02-second",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-02): do more", body: "Does more." },
    },
  ],
};

const RAW_RUN_STATUS_RESET = {
  version: 1,
  namespace: NAMESPACE,
  shortName: "my-run",
  runId: "my-run-1234567890",
  state: "interrupted",
  stoppedReason: "phase_reset",
  createdAt: NOW,
  updatedAt: NOW,
  phasesCount: 2,
  gateProfileId: "full",
};

describe("resolveRun + inspectResume after reset-phase", () => {
  let stateRoot: string;
  let runPath: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-reset-"));
    runPath = join(stateRoot, "runs", runKey(NAMESPACE, "my-run"));
    await mkdir(runPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("resolveRun returns Right when only an archived phase folder exists", async () => {
    await writeFile(join(runPath, "run-status.json"), JSON.stringify(RAW_RUN_STATUS_RESET));
    await writeFile(join(runPath, "phax-plan.json"), JSON.stringify(RAW_PLAN));
    // Simulate reset-phase: archive phase-01 folder (renamed, no longer matches /^phase-\d{2}$/)
    await mkdir(join(runPath, "phase-01.reset-20260625T000000000Z"), { recursive: true });

    const result = resolveRun(NAMESPACE, SHORT_NAME, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.phaseStatuses).toHaveLength(0);
      expect(result.right.finalPhaseId).toBe("phase-02");
      expect(result.right.finalPhaseTitle).toBe("Second Phase");
      expect(result.right.worktreePath).toBe("");
      expect(result.right.claudeSessionId).toBeUndefined();
      expect(result.right.runState).toBe("interrupted");
      expect(result.right.planPhases).toHaveLength(2);
    }
  });

  it("inspectResume returns Right and picks phase-01 as the next resumable phase", async () => {
    await writeFile(join(runPath, "run-status.json"), JSON.stringify(RAW_RUN_STATUS_RESET));
    await writeFile(join(runPath, "phax-plan.json"), JSON.stringify(RAW_PLAN));
    await mkdir(join(runPath, "phase-01.reset-20260625T000000000Z"), { recursive: true });

    const result = inspectResume(NAMESPACE, SHORT_NAME, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.nextPhaseId).toBe("phase-01");
      expect(result.right.nextPhaseIndex).toBe(0);
    }
  });

  it("resolveRun returns Right even with no phase folders at all (run not yet started)", async () => {
    await writeFile(
      join(runPath, "run-status.json"),
      JSON.stringify({ ...RAW_RUN_STATUS_RESET, state: "running", stoppedReason: undefined }),
    );
    await writeFile(join(runPath, "phax-plan.json"), JSON.stringify(RAW_PLAN));
    // No phase folders at all

    const result = resolveRun(NAMESPACE, SHORT_NAME, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.phaseStatuses).toHaveLength(0);
      expect(result.right.finalPhaseId).toBe("phase-02");
    }
  });

  it("happy path: resolveRun with a live phase-01 folder returns correct data", async () => {
    await writeFile(
      join(runPath, "run-status.json"),
      JSON.stringify({ ...RAW_RUN_STATUS_RESET, state: "running", stoppedReason: undefined }),
    );
    await writeFile(join(runPath, "phax-plan.json"), JSON.stringify(RAW_PLAN));

    const phase01Dir = join(runPath, "phase-01");
    await mkdir(phase01Dir, { recursive: true });
    await writeFile(
      join(phase01Dir, "status.json"),
      JSON.stringify({
        version: 1,
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "running",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: "ai/my-run--phase-01",
        createdAt: NOW,
        updatedAt: NOW,
        worktreePath: join(stateRoot, "worktrees", "test-project.my-run", "phase-01"),
      }),
    );

    const result = resolveRun(NAMESPACE, SHORT_NAME, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.phaseStatuses).toHaveLength(1);
      expect(result.right.finalPhaseId).toBe("phase-01");
      expect(result.right.finalPhaseTitle).toBe("First Phase");
      expect(result.right.worktreePath).toBe(
        join(stateRoot, "worktrees", "test-project.my-run", "phase-01"),
      );
    }
  });

  it("resolveRun fails when run-status.json is missing", async () => {
    // No run-status.json
    await writeFile(join(runPath, "phax-plan.json"), JSON.stringify(RAW_PLAN));

    const result = resolveRun(NAMESPACE, SHORT_NAME, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
  });

  it("resolveRun fails when both phaseStatuses is empty and plan is missing", async () => {
    await writeFile(join(runPath, "run-status.json"), JSON.stringify(RAW_RUN_STATUS_RESET));
    // No phax-plan.json and no phase folders

    const result = resolveRun(NAMESPACE, SHORT_NAME, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toContain("No phase statuses found");
    }
  });
});
