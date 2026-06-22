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
  namespace: "test-project",
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
      const err = result.left as GateAttemptsExhaustedError;
      expect(err.command).toBe("pnpm test");
      expect(err.attempt).toBe(2);
    }

    // After max attempts the loop dispatches FixAttemptsExhausted at least once
    // and pauses the phase in `gates_exhausted` (resumable, not terminal).
    const transitionEvents = fakeTelemetry.impl
      .events()
      .filter((e) => e.type === "state.transition")
      .map((e) => ("event" in e ? e.event : ""));
    expect(transitionEvents).toContain("FixAttemptsExhausted");

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

  it("startAttempt > 1: gate passes on first re-run without invoking fix agent or clobbering prior artifacts", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });
    seedStatusFiles(fakeFs);

    const outcome = await Effect.runPromise(
      runGatesWithFixLoop({ ...baseOpts, startAttempt: 3 }).pipe(Effect.provide(layer)),
    );

    expect(outcome.attemptLogPath).toContain("checks-attempt-03");
    expect(fakeBackend.impl.resumeCalls).toHaveLength(0);
    // Prior attempt artifacts not written
    expect(fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-01.log`)).toBeUndefined();
    expect(fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-02.log`)).toBeUndefined();
  });

  it("startAttempt > 1: grants a fresh maxFixAttempts budget and fails with GateAttemptsExhaustedError", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResult("sess-resume-fix"));
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "still fails" });

    const result = await Effect.runPromise(
      Effect.either(
        runGatesWithFixLoop({ ...baseOpts, startAttempt: 3 }).pipe(Effect.provide(layer)),
      ),
    );

    // maxFixAttempts=1: one gate at attempt 3 fails → one fix → gate at attempt 4 fails → exhausted
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GateAttemptsExhaustedError);
      const err = result.left as GateAttemptsExhaustedError;
      expect(err.attempt).toBe(4); // 3 + 1 fix attempt
    }
    expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
    // Artifacts numbered from startAttempt, not from 1
    expect(fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-01.log`)).toBeUndefined();
    expect(fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-03.log`)).toBeDefined();
  });

  it("regression: startAttempt=1 produces checks-attempt-01 on success and attempt-02 after one fix", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResult());
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "", stderr: "fail once" },
      { exitCode: 0, stdout: "ok", stderr: "" },
    );

    const outcome = await Effect.runPromise(
      runGatesWithFixLoop({ ...baseOpts, startAttempt: 1 }).pipe(Effect.provide(layer)),
    );

    expect(outcome.attemptLogPath).toContain("checks-attempt-02");
    expect(fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-01.log`)).toBeDefined();
    expect(fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-02.log`)).toBeDefined();
  });
});
