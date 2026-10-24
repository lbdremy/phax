import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import { decodeShortName } from "../../src/domain/branded.js";
import { findNextResumablePhase, readRunHold } from "../../src/app/resume.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { FsError } from "../../src/ports/fs.js";
import { inspectResumeOnDisk } from "../helpers/inspectResume.js";
import { buildResumeInstructions } from "../../src/app/resumeInstructions.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { phaseStatus, phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import type { PhaseStatus, RunHold } from "../../src/schemas/status.js";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const shortName = unwrap(decodeShortName("test-run"));
const now = new Date().toISOString();

function makeRunStatus(state: string, extra: Record<string, unknown> = {}): object {
  return {
    $schema: currentSchemaUrl("run-status"),
    namespace: "test-project",
    shortName: "test-run",
    runId: "test-run-123",
    state,
    createdAt: now,
    updatedAt: now,
    phasesCount: 1,
    hold: { selection: "none" },
    ...extra,
  };
}

function makePhaseStatus(state: PhaseStatus["state"]): object {
  return phaseStatusFile({
    phaseId: "phase-01",
    phaseIndex: 0,
    state,
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: "ai/test-run--phase-01",
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    createdAt: now,
    updatedAt: now,
  });
}

function makePlanPhase(id: string) {
  return {
    id,
    title: `${id} title`,
    model: "claude-sonnet-4-6",
    effort: "low",
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    commit: { subject: `feat: ${id}`, body: `${id} body` },
  };
}

describe("buildResumeInstructions", () => {
  const base = {
    runPath: "/runs/my-run",
    shortName: "my-run",
    reason: "Gate checks failed",
    kind: "gates_exhausted" as const,
    phaseId: "phase-03",
    worktreePath: "/worktrees/my-run--phase-03",
    sessionId: "sess-abc123",
    now: new Date("2026-06-19T12:00:00.000Z"),
    platform: "other" as const,
  };

  it("gate-exhaustion body mentions re-running the gate and phax resume", () => {
    const md = buildResumeInstructions(base);
    expect(md).toContain("gate");
    expect(md).toContain("phax resume my-run");
  });

  it("gate-exhaustion body mentions phax reset-phase", () => {
    const md = buildResumeInstructions(base);
    expect(md).toContain("phax reset-phase my-run phase-03");
  });

  it("gate-exhaustion body does not include a reset time", () => {
    const md = buildResumeInstructions(base);
    expect(md).not.toContain("Reset time");
    expect(md).not.toContain("retry later");
  });

  it("rate-limit body is unchanged (no regression)", () => {
    const md = buildResumeInstructions({
      runPath: "/runs/my-run",
      shortName: "my-run",
      reason: "Rate limit",
      kind: "rate_limit",
      resetAt: "2026-06-12T00:00:00Z",
      phaseId: "phase-01",
      now: new Date("2026-06-19T12:00:00.000Z"),
      platform: "other",
    });
    expect(md).toContain("Reset time");
    expect(md).toContain("2026-06-12T00:00:00Z");
    expect(md).not.toContain("phax reset-phase");
  });
});

describe("findNextResumablePhase — the run's hold", () => {
  const planPhases = ["phase-01", "phase-02", "phase-03"].map((id) => ({ id, title: id }));
  const listed: RunHold = { selection: "listed", phases: ["phase-02"] };
  const none: RunHold = { selection: "none" };
  const statusOf = (
    phaseId: string,
    phaseIndex: number,
    state: PhaseStatus["state"],
    stop: PhaseStatus["stop"] = null,
  ): PhaseStatus =>
    phaseStatus({
      phaseId,
      phaseIndex,
      state,
      model: "gpt-6-luna",
      effort: "medium",
      branchName: `phax/invoice-export--${phaseId}`,
      base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      createdAt: now,
      updatedAt: now,
      stop,
    });

  it.each([
    {
      name: "a committed held phase whose stop is owed",
      phase02: statusOf("phase-02", 1, "committed"),
      hold: listed,
      expected: "phase-02",
    },
    {
      name: "a committed phase outside the hold",
      phase02: statusOf("phase-02", 1, "committed"),
      hold: none,
      expected: "phase-03",
    },
    {
      name: "a committed held phase whose stop is closed: its cleanup is owed",
      phase02: statusOf("phase-02", 1, "committed", {
        cause: "held",
        status: "closed",
        outcome: "unchanged",
        closedBy: { name: "Ada Example", email: "ada@example.com" },
      }),
      hold: listed,
      expected: "phase-02",
    },
    {
      name: "a committed declared phase whose stop is closed: its cleanup is owed",
      phase02: statusOf("phase-02", 1, "committed", {
        cause: "declared",
        status: "closed",
        outcome: "unchanged",
        closedBy: { name: "Ada Example", email: "ada@example.com" },
      }),
      hold: none,
      expected: "phase-02",
    },
    {
      name: "a cleaned-up held phase",
      phase02: statusOf("phase-02", 1, "cleaned_up"),
      hold: listed,
      expected: "phase-03",
    },
  ])("$name → $expected", ({ phase02, hold, expected }) => {
    const statuses = [statusOf("phase-01", 0, "cleaned_up"), phase02];
    expect(findNextResumablePhase(statuses, planPhases, hold)?.phaseId).toBe(expected);
  });

  it("never holds the final phase: a committed final phase is resumable as before", () => {
    const statuses = [
      statusOf("phase-01", 0, "cleaned_up"),
      statusOf("phase-02", 1, "cleaned_up"),
      statusOf("phase-03", 2, "committed"),
    ];
    const all: RunHold = { selection: "listed", phases: ["phase-03"] };
    expect(findNextResumablePhase(statuses, planPhases, all)?.phaseId).toBe("phase-03");
  });
});

describe("inspectResume", () => {
  let stateRoot: string;
  let runPath: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-resume-test-"));
    runPath = join(stateRoot, "runs", "test-project.test-run");
    mkdirSync(runPath, { recursive: true });
    mkdirSync(join(runPath, "phase-01"), { recursive: true });
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("refuses runs in created state with reason=created", async () => {
    writeFileSync(join(runPath, "run-status.json"), JSON.stringify(makeRunStatus("created")));
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("pending")),
    );

    const result = await inspectResumeOnDisk("test-project", shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("expected refusal");
    expect(result.left.reason).toBe("created");
    expect(result.left.message).toContain("test-run");
    expect(result.left.message).toContain("not been started");
  });

  it("refuses runs in failed state with reason=failed", async () => {
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify(makeRunStatus("failed", { lastError: "gate check failed" })),
    );
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("failed")),
    );

    const result = await inspectResumeOnDisk("test-project", shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("expected refusal");
    expect(result.left.reason).toBe("failed");
    expect(result.left.message).toContain("test-run");
    expect(result.left.message).toContain("failed");
    expect(result.left.message).toContain("phax reset-phase test-run");
  });

  it("refuses runs in review_open state with reason=review_open", async () => {
    writeFileSync(join(runPath, "run-status.json"), JSON.stringify(makeRunStatus("review_open")));
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("review_open")),
    );

    const result = await inspectResumeOnDisk("test-project", shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("expected refusal");
    expect(result.left.reason).toBe("review_open");
    expect(result.left.message).toContain("phax enter");
  });

  it("allows runs in rate_limited state", async () => {
    writeFileSync(join(runPath, "run-status.json"), JSON.stringify(makeRunStatus("rate_limited")));
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("rate_limited")),
    );

    const result = await inspectResumeOnDisk("test-project", shortName, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error("expected decision");
    expect(result.right.fromState).toBe("rate_limited");
    expect(result.right.nextPhaseId).toBe("phase-01");
  });

  it("phase-01 skipped + phase-02 not yet on disk → resumes from phase-02", async () => {
    // Scenario: phase-01 had no changes (skipped), phase-02 folder doesn't exist yet.
    // The plan lists both phases; inspectResume should find phase-02 as the next resumable.
    const plan = {
      version: 1,
      run: {
        shortName: "test-run",
        title: "Test run",
        branch: "ai/test-run",
        requiredCommands: [],
      },
      phases: [
        {
          id: "phase-01",
          title: "Phase 01",
          model: "claude-sonnet-4-6",
          effort: "low",
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase-01", body: "Phase 01 body" },
        },
        {
          id: "phase-02",
          title: "Phase 02",
          model: "claude-sonnet-4-6",
          effort: "low",
          planMarkdownAnchor: "#phase-02",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: phase-02", body: "Phase 02 body" },
        },
      ],
    };
    writeFileSync(join(runPath, "phax-plan.json"), JSON.stringify(plan));
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify(makeRunStatus("interrupted", { stoppedReason: "no_changes", phasesCount: 2 })),
    );
    // phase-01 is skipped (terminal); phase-02 folder doesn't exist
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify({ ...makePhaseStatus("skipped"), phaseId: "phase-01", phaseIndex: 0 }),
    );

    const result = await inspectResumeOnDisk("test-project", shortName, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error(`expected decision, got: ${result.left.message}`);
    expect(result.right.nextPhaseId).toBe("phase-02");
    expect(result.right.nextPhaseIndex).toBe(1);
    expect(result.right.skippedPhaseIds).toContain("phase-01");
  });

  it("phase-01 skipped + phase-02 skipped + phase-03 not yet on disk → resumes from phase-03", async () => {
    const plan = {
      version: 1,
      run: {
        shortName: "test-run",
        title: "Test run",
        branch: "ai/test-run",
        requiredCommands: [],
      },
      phases: [makePlanPhase("phase-01"), makePlanPhase("phase-02"), makePlanPhase("phase-03")],
    };
    writeFileSync(join(runPath, "phax-plan.json"), JSON.stringify(plan));
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify(makeRunStatus("interrupted", { stoppedReason: "no_changes", phasesCount: 3 })),
    );

    const makeSkippedStatus = (id: string, index: number) =>
      JSON.stringify(
        phaseStatusFile({
          phaseId: id,
          phaseIndex: index,
          state: "skipped",
          model: "claude-sonnet-4-6",
          effort: "low",
          branchName: `ai/test-run--${id}`,
          base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          createdAt: now,
          updatedAt: now,
        }),
      );

    mkdirSync(join(runPath, "phase-02"), { recursive: true });
    writeFileSync(join(runPath, "phase-01", "status.json"), makeSkippedStatus("phase-01", 0));
    writeFileSync(join(runPath, "phase-02", "status.json"), makeSkippedStatus("phase-02", 1));
    // phase-03 folder does not exist

    const result = await inspectResumeOnDisk("test-project", shortName, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error(`expected decision, got: ${result.left.message}`);
    expect(result.right.nextPhaseId).toBe("phase-03");
    expect(result.right.nextPhaseIndex).toBe(2);
    expect(result.right.skippedPhaseIds).toEqual(["phase-01", "phase-02"]);
  });

  it("final phase left committed on an interrupted run (artifact-completion pause) → resumes from it", async () => {
    // ArtifactCompletionFailed leaves the run `interrupted` and the FINAL phase
    // `committed` (commit + handoff already landed; only the completion step
    // remains). `committed` is terminal for non-final phases, so the resume scan
    // must special-case the final phase or the pause is unreachable.
    const plan = {
      version: 1,
      run: {
        shortName: "test-run",
        title: "Test run",
        branch: "ai/test-run",
        requiredCommands: [],
      },
      phases: [makePlanPhase("phase-01")],
    };
    writeFileSync(join(runPath, "phax-plan.json"), JSON.stringify(plan));
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify(
        makeRunStatus("interrupted", {
          stoppedReason: "artifact_completion_failed",
          lastError: 'Artifact completion failed for phase "phase-01": boom',
        }),
      ),
    );
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify({ ...makePhaseStatus("committed"), commitHash: "abc1234" }),
    );

    const result = await inspectResumeOnDisk("test-project", shortName, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error(`expected decision, got: ${result.left.message}`);
    expect(result.right.fromState).toBe("interrupted");
    expect(result.right.nextPhaseId).toBe("phase-01");
    expect(result.right.nextPhaseIndex).toBe(0);
  });

  it("non-final committed phase stays terminal → resumes from the next phase, not the committed one", async () => {
    // Guard on the special-case scoping: only the FINAL phase's `committed` is
    // resumable. A non-final `committed` phase must remain terminal so the scan
    // advances to the next (unstarted) phase.
    const plan = {
      version: 1,
      run: {
        shortName: "test-run",
        title: "Test run",
        branch: "ai/test-run",
        requiredCommands: [],
      },
      phases: [makePlanPhase("phase-01"), makePlanPhase("phase-02")],
    };
    writeFileSync(join(runPath, "phax-plan.json"), JSON.stringify(plan));
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify(makeRunStatus("interrupted", { phasesCount: 2 })),
    );
    // phase-01 committed (non-final, terminal); phase-02 folder does not exist.
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify({ ...makePhaseStatus("committed"), phaseId: "phase-01", phaseIndex: 0 }),
    );

    const result = await inspectResumeOnDisk("test-project", shortName, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error(`expected decision, got: ${result.left.message}`);
    expect(result.right.nextPhaseId).toBe("phase-02");
    expect(result.right.nextPhaseIndex).toBe(1);
  });

  it("a non-final committed phase of the recorded hold, its stop owed → resumes from it", async () => {
    const plan = {
      version: 1,
      run: {
        shortName: "test-run",
        title: "Test run",
        branch: "ai/test-run",
        requiredCommands: [],
      },
      phases: [makePlanPhase("phase-01"), makePlanPhase("phase-02")],
    };
    writeFileSync(join(runPath, "phax-plan.json"), JSON.stringify(plan));
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify(
        makeRunStatus("interrupted", {
          phasesCount: 2,
          stoppedReason: "hold_point_failed",
          hold: { selection: "listed", phases: ["phase-01"] },
        }),
      ),
    );
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify({ ...makePhaseStatus("committed"), phaseId: "phase-01", phaseIndex: 0 }),
    );

    const result = await inspectResumeOnDisk("test-project", shortName, stateRoot);

    if (Either.isLeft(result)) throw new Error(`expected decision, got: ${result.left.message}`);
    expect(result.right.nextPhaseId).toBe("phase-01");
    expect(result.right.nextPhaseIndex).toBe(0);
  });
});

describe("readRunHold", () => {
  const runPath = "/example/runs/test-project.test-run";
  const statusPath = `${runPath}/run-status.json`;

  function read(content: string) {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(statusPath, content);
    return Effect.runSync(Effect.either(readRunHold(runPath).pipe(Effect.provide(fs.layer))));
  }

  it("reads the recorded hold through the FileSystem port", () => {
    const hold = { selection: "listed", phases: ["phase-02", "phase-04"] };
    expect(read(JSON.stringify(makeRunStatus("interrupted", { hold })))).toEqual(
      Either.right(hold),
    );
  });

  it("fails with an FsError naming the file when it is not JSON or not a run status", () => {
    const notJson = read("{");
    expect(Either.isLeft(notJson) && notJson.left.message).toBe(`${statusPath}: not valid JSON`);
    const withoutHold = { ...makeRunStatus("interrupted") } as Record<string, unknown>;
    delete withoutHold["hold"];
    const refused = read(JSON.stringify(withoutHold));
    if (Either.isRight(refused)) throw new Error("expected a refusal");
    expect(refused.left).toBeInstanceOf(FsError);
  });
});
