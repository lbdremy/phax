import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { runGatesWithFixLoop } from "../../src/app/fixLoop.js";
import { GateAttemptsExhaustedError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";

const runPath = "/fake/runs/my-run";
const cwd = "/fake/worktrees/my-run/phase-01";
const phaseFolderPath = `${runPath}/phase-01`;
const sessionId = "sess-abc123" as ClaudeSessionId;

const phaseStatusJson = JSON.stringify({
  version: 1,
  phaseId: "phase-01",
  phaseIndex: 0,
  state: "running",
  model: "claude-sonnet-4-6",
  effort: "low",
  branchName: "ai/my-run--phase-01",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const runStatusJson = JSON.stringify({
  version: 1,
  shortName: "my-run",
  runId: "my-run-2026-05-22",
  state: "running",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  phasesCount: 1,
  currentPhaseIndex: 0,
});

const baseOpts = {
  commands: ["pnpm test"],
  cwd,
  worktreePath: cwd,
  phaseFolderPath,
  sessionId,
  agentOptions: {
    provider: "claude-code" as const,
    model: "claude-sonnet-4-6",
    effort: "medium",
    cwd,
    phaseFolderPath,
  },
  maxFixAttempts: 1,
  run: "my-run",
  phaseId: "phase-01",
  runPath,
};

function makeResumeResult(newSessionId = "sess-fixed") {
  return {
    sessionId: newSessionId as ClaudeSessionId,
    outputPath: `${phaseFolderPath}/fix-attempt-01.jsonl`,
    finalText: "Fixed.",
  };
}

function makeResumeResultForAttempt(attempt: number, newSessionId = `sess-fixed-${attempt}`) {
  return {
    sessionId: newSessionId as ClaudeSessionId,
    outputPath: `${phaseFolderPath}/fix-attempt-${String(attempt).padStart(2, "0")}.jsonl`,
    finalText: "Fixed.",
  };
}

function seedStatusFiles(fakeFs: ReturnType<typeof makeFakeFileSystem>) {
  fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, phaseStatusJson);
  fakeFs.impl.setFile(`${runPath}/run-status.json`, runStatusJson);
}

function makeLayers() {
  const fakeFs = makeFakeFileSystem();
  const fakeShell = makeFakeShell();
  const fakeBackend = makeFakeBackend();
  const fakeGit = makeFakeGit();
  const fakeTelemetry = makeFakeSystemTelemetry();
  const layer = Layer.mergeAll(
    fakeFs.layer,
    fakeShell.layer,
    fakeBackend.layer,
    fakeGit.layer,
    fakeTelemetry.layer,
  );
  return { layer, fakeFs, fakeShell, fakeBackend, fakeGit, fakeTelemetry };
}

describe("runGatesWithFixLoop", () => {
  it("succeeds immediately when gates pass on the first attempt", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });
    seedStatusFiles(fakeFs);

    const outcome = await Effect.runPromise(
      runGatesWithFixLoop(baseOpts).pipe(Effect.provide(layer)),
    );

    expect(outcome.attemptLogPath).toContain("checks-attempt-01");
    expect(fakeBackend.impl.resumeCalls).toHaveLength(0);
  });

  it("calls resumeAgentSession on gate failure and dispatches the fix-loop event sequence", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend, fakeTelemetry } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResult());
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "", stderr: "test failure" },
      { exitCode: 0, stdout: "ok", stderr: "" },
    );

    const outcome = await Effect.runPromise(
      runGatesWithFixLoop(baseOpts).pipe(Effect.provide(layer)),
    );

    expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
    expect(outcome.attemptLogPath).toContain("checks-attempt-02");

    // The event sequence: GateFailed → FixStarted → FixCompleted → GatePassed (state transitions).
    const telEvents = fakeTelemetry.impl.events();
    const transitionEvents = telEvents
      .filter((e) => e.type === "state.transition")
      .map((e) => ("event" in e ? e.event : ""));
    expect(transitionEvents).toContain("GateFailed");
    expect(transitionEvents).toContain("GatePassed");

    const persisted = JSON.parse(fakeFs.impl.getFile(`${phaseFolderPath}/status.json`)!) as {
      state: string;
    };
    expect(persisted.state).toBe("passed");

    // The first gate failure should produce a SystemErrorReport.
    const errors = fakeTelemetry.impl.errors();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const gateReport = errors.find((e) => e.adapter === "shell");
    expect(gateReport).toBeDefined();
    expect(gateReport!.adapter).toBe("shell");
    expect(gateReport!.operation).toBe("gate.pnpm test");
    expect(gateReport!.exitCode).toBe(1);
    expect(gateReport!.stderrExcerpt).toBe("test failure");
  });

  it("fails with GateAttemptsExhaustedError and dispatches FixAttemptsExhausted after all attempts fail", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend, fakeTelemetry } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResult());
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "always fails" });

    const result = await Effect.runPromise(
      Effect.either(runGatesWithFixLoop(baseOpts).pipe(Effect.provide(layer))),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GateAttemptsExhaustedError);
      expect(result.left.attempt).toBe(2);
      expect(result.left.command).toBe("pnpm test");
      expect(result.left.logPath).toContain("checks-attempt-02");
    }

    // After max attempts the loop dispatches FixAttemptsExhausted at least once
    // and parks the run for a resumable gate-exhaustion pause.
    const transitionEvents = fakeTelemetry.impl
      .events()
      .filter((e) => e.type === "state.transition")
      .map((e) => ("event" in e ? e.event : ""));
    expect(transitionEvents).toContain("FixAttemptsExhausted");

    const persisted = JSON.parse(fakeFs.impl.getFile(`${phaseFolderPath}/status.json`)!) as {
      state: string;
    };
    expect(persisted.state).toBe("gates_exhausted");

    const persistedRun = JSON.parse(fakeFs.impl.getFile(`${runPath}/run-status.json`)!) as {
      state: string;
      stoppedReason?: string;
      lastError?: string;
    };
    expect(persistedRun.state).toBe("interrupted");
    expect(persistedRun.stoppedReason).toBe("gates_exhausted");
    expect(persistedRun.lastError).toBe("Gate failed: pnpm test");
  });

  it("starts from a supplied attempt and passes without invoking the fix agent", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
    const oldAttemptLog = "previous attempt log";

    seedStatusFiles(fakeFs);
    fakeFs.impl.setFile(`${phaseFolderPath}/checks-attempt-01.log`, oldAttemptLog);
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });

    const outcome = await Effect.runPromise(
      runGatesWithFixLoop({ ...baseOpts, startAttempt: 3 }).pipe(Effect.provide(layer)),
    );

    expect(outcome.attemptLogPath).toContain("checks-attempt-03");
    expect(fakeBackend.impl.resumeCalls).toHaveLength(0);
    expect(fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-01.log`)).toBe(oldAttemptLog);
    expect(fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-03.log`)).toContain("exit 0");
  });

  it("uses a fresh fix budget when startAttempt is greater than one", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResultForAttempt(3, "sess-after-fix-3"));
    fakeBackend.impl.addResumeResponse(makeResumeResultForAttempt(4, "sess-after-fix-4"));
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "still fails" });

    const result = await Effect.runPromise(
      Effect.either(
        runGatesWithFixLoop({ ...baseOpts, startAttempt: 3, maxFixAttempts: 2 }).pipe(
          Effect.provide(layer),
        ),
      ),
    );

    expect(fakeBackend.impl.resumeCalls).toHaveLength(2);
    expect(fakeBackend.impl.resumeCalls[0]?.options.outputJsonlPath).toContain(
      "fix-attempt-03.jsonl",
    );
    expect(fakeBackend.impl.resumeCalls[1]?.options.outputJsonlPath).toContain(
      "fix-attempt-04.jsonl",
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GateAttemptsExhaustedError);
      expect(result.left.attempt).toBe(5);
      expect(result.left.logPath).toContain("checks-attempt-05.log");
    }

    const persisted = JSON.parse(fakeFs.impl.getFile(`${phaseFolderPath}/status.json`)!) as {
      state: string;
    };
    expect(persisted.state).toBe("gates_exhausted");
  });

  it("includes gate output in the fix prompt sent to resumeAgentSession", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResult());
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "some stdout", stderr: "some stderr" },
      { exitCode: 0, stdout: "ok", stderr: "" },
    );

    await Effect.runPromise(runGatesWithFixLoop(baseOpts).pipe(Effect.provide(layer)));

    expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
    const { prompt } = fakeBackend.impl.resumeCalls[0]!;
    expect(prompt).toContain("Gate checks failed");
    expect(prompt).toContain("pnpm test");
  });

  it("uses the session id from the fix result in the next gate attempt", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResult("sess-after-fix"));
    fakeBackend.impl.addResumeResponse(makeResumeResult("sess-after-fix-2"));
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "", stderr: "fail" },
      { exitCode: 0, stdout: "ok", stderr: "" },
    );

    await Effect.runPromise(
      runGatesWithFixLoop({ ...baseOpts, maxFixAttempts: 2 }).pipe(Effect.provide(layer)),
    );

    expect(fakeBackend.impl.resumeCalls[0]?.sessionId).toBe(sessionId);
  });
});
