import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either, Layer } from "effect";
import { decodeShortName } from "../../src/domain/branded.js";
import { inspectResume } from "../../src/app/resume.js";
import { buildResumeInstructions } from "../../src/app/resumeInstructions.js";
import { run as runEffectCommand } from "../../src/app/effectRunner.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";

function unwrap<T>(e: Either.Either<T, unknown>): T {
  if (Either.isLeft(e)) throw new Error("decode failed");
  return e.right;
}

const shortName = unwrap(decodeShortName("test-run"));
const now = new Date().toISOString();

function makeRunStatus(state: string, extra: Record<string, unknown> = {}): object {
  return {
    version: 1,
    shortName: "test-run",
    runId: "test-run-123",
    state,
    createdAt: now,
    updatedAt: now,
    phasesCount: 1,
    ...extra,
  };
}

function makePhaseStatus(state: string): object {
  return {
    version: 1,
    phaseId: "phase-01",
    phaseIndex: 0,
    state,
    model: "claude-sonnet-4-6",
    effort: "low",
    branchName: "ai/test-run--phase-01",
    createdAt: now,
    updatedAt: now,
  };
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

describe("inspectResume", () => {
  let stateRoot: string;
  let runPath: string;

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-resume-test-"));
    runPath = join(stateRoot, "runs", "test-run");
    mkdirSync(runPath, { recursive: true });
    mkdirSync(join(runPath, "phase-01"), { recursive: true });
  });

  afterEach(() => {
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it("refuses runs in created state with reason=created", () => {
    writeFileSync(join(runPath, "run-status.json"), JSON.stringify(makeRunStatus("created")));
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("pending")),
    );

    const result = inspectResume(shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("expected refusal");
    expect(result.left.reason).toBe("created");
    expect(result.left.message).toContain("test-run");
    expect(result.left.message).toContain("not been started");
  });

  it("refuses runs in failed state with reason=failed", () => {
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify(makeRunStatus("failed", { lastError: "gate check failed" })),
    );
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("failed")),
    );

    const result = inspectResume(shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("expected refusal");
    expect(result.left.reason).toBe("failed");
    expect(result.left.message).toContain("test-run");
    expect(result.left.message).toContain("failed");
  });

  it("refuses runs in review_open state with reason=review_open", () => {
    writeFileSync(join(runPath, "run-status.json"), JSON.stringify(makeRunStatus("review_open")));
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("review_open")),
    );

    const result = inspectResume(shortName, stateRoot);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) throw new Error("expected refusal");
    expect(result.left.reason).toBe("review_open");
    expect(result.left.message).toContain("phax enter");
  });

  it("allows runs in rate_limited state", () => {
    writeFileSync(join(runPath, "run-status.json"), JSON.stringify(makeRunStatus("rate_limited")));
    writeFileSync(
      join(runPath, "phase-01", "status.json"),
      JSON.stringify(makePhaseStatus("rate_limited")),
    );

    const result = inspectResume(shortName, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error("expected decision");
    expect(result.right.fromState).toBe("rate_limited");
    expect(result.right.nextPhaseId).toBe("phase-01");
  });

  it("phase-01 skipped + phase-02 not yet on disk → resumes from phase-02", () => {
    // Scenario: phase-01 had no changes (skipped), phase-02 folder doesn't exist yet.
    // The plan lists both phases; inspectResume should find phase-02 as the next resumable.
    const plan = {
      version: 1,
      run: {
        shortName: "test-run",
        title: "Test run",
        branch: "ai/test-run",
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

    const result = inspectResume(shortName, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error(`expected decision, got: ${result.left.message}`);
    expect(result.right.nextPhaseId).toBe("phase-02");
    expect(result.right.nextPhaseIndex).toBe(1);
    expect(result.right.skippedPhaseIds).toContain("phase-01");
  });

  it("phase-01 skipped + phase-02 skipped + phase-03 not yet on disk → resumes from phase-03", () => {
    const plan = {
      version: 1,
      run: {
        shortName: "test-run",
        title: "Test run",
        branch: "ai/test-run",
      },
      phases: [makePlanPhase("phase-01"), makePlanPhase("phase-02"), makePlanPhase("phase-03")],
    };
    writeFileSync(join(runPath, "phax-plan.json"), JSON.stringify(plan));
    writeFileSync(
      join(runPath, "run-status.json"),
      JSON.stringify(makeRunStatus("interrupted", { stoppedReason: "no_changes", phasesCount: 3 })),
    );

    const makeSkippedStatus = (id: string, index: number) =>
      JSON.stringify({
        version: 1,
        phaseId: id,
        phaseIndex: index,
        state: "skipped",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: `ai/test-run--${id}`,
        createdAt: now,
        updatedAt: now,
      });

    mkdirSync(join(runPath, "phase-02"), { recursive: true });
    writeFileSync(join(runPath, "phase-01", "status.json"), makeSkippedStatus("phase-01", 0));
    writeFileSync(join(runPath, "phase-02", "status.json"), makeSkippedStatus("phase-02", 1));
    // phase-03 folder does not exist

    const result = inspectResume(shortName, stateRoot);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) throw new Error(`expected decision, got: ${result.left.message}`);
    expect(result.right.nextPhaseId).toBe("phase-03");
    expect(result.right.nextPhaseIndex).toBe(2);
    expect(result.right.skippedPhaseIds).toEqual(["phase-01", "phase-02"]);
  });
});

describe("resume instructions", () => {
  it("renders gate-exhaustion instructions without a reset time", () => {
    const markdown = buildResumeInstructions({
      runPath: "/state/runs/test-run",
      shortName: "test-run",
      kind: "gates_exhausted",
      reason: "Gate checks failed",
      phaseId: "phase-01",
      worktreePath: "/state/worktrees/test-run/phase-01",
      sessionId: "claude-session-123",
    });

    expect(markdown).toContain("Gate checks failed");
    expect(markdown).toContain("maxFixAttempts");
    expect(markdown).toContain("Fix the gate by hand in the worktree");
    expect(markdown).toContain("phax resume test-run --yes");
    expect(markdown).toContain("re-runs the gate");
    expect(markdown).toContain("commits with no agent invocation");
    expect(markdown).toContain("phax reset-phase test-run phase-01");
    expect(markdown).not.toContain("Reset time");
  });

  it("maps gates_exhausted WriteResumeInstructions through the effect runner", async () => {
    const fakeFs = makeFakeFileSystem();
    const layer = Layer.mergeAll(
      fakeFs.layer,
      makeFakeGit().layer,
      makeFakeShell().layer,
      makeFakeSystemTelemetry().layer,
    );

    await Effect.runPromise(
      runEffectCommand(
        {
          type: "WriteResumeInstructions",
          ctx: {
            kind: "gates_exhausted",
            reason: "Gate checks failed",
            phaseId: "phase-01",
            worktreePath: "/state/worktrees/test-run/phase-01",
            sessionId: "claude-session-123",
          },
        },
        {
          runPath: "/state/runs/test-run",
          shortName: "test-run",
          phaseFolderPath: "/state/runs/test-run/phase-01",
          phaseId: "phase-01",
        },
      ).pipe(Effect.provide(layer)),
    );

    const markdown = fakeFs.impl.getFile("/state/runs/test-run/resume-instructions.md");
    expect(markdown).toBeDefined();
    expect(markdown).toContain("Gate checks failed");
    expect(markdown).toContain("phax resume test-run --yes");
    expect(markdown).toContain("phax reset-phase test-run phase-01");
    expect(markdown).not.toContain("Reset time");
  });
});
