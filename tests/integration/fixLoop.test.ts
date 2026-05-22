import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { runGatesWithFixLoop } from "../../src/app/fixLoop.js";
import { GateFailedError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeTracer } from "../../src/infra/fakes/tracer.js";
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
  phaseFolderPath,
  sessionId,
  agentOptions: {
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
  const fakeTracer = makeFakeTracer();
  const layer = Layer.mergeAll(
    fakeFs.layer,
    fakeShell.layer,
    fakeBackend.layer,
    fakeGit.layer,
    fakeTracer.layer,
  );
  return { layer, fakeFs, fakeShell, fakeBackend, fakeGit, fakeTracer };
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
    const { layer, fakeFs, fakeShell, fakeBackend, fakeTracer } = makeLayers();

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

    // The event sequence: GateFailed → FixStarted → FixCompleted → GatePassed.
    const dispositionEvents = fakeTracer.impl.events.filter(
      (e) => e.event === "event.handled",
    );
    const dispositionTypes = dispositionEvents.map((e) => e.details?.eventType);
    expect(dispositionTypes).toEqual(["GateFailed", "FixStarted", "FixCompleted", "GatePassed"]);

    // Phase state transitions reflect the reducer's view.
    const phaseTransitions = fakeTracer.impl.events
      .filter((e) => e.event === "state.transition")
      .map((e) => (e.details as { entity?: string; to?: string }).to);
    expect(phaseTransitions).toEqual(["gates_failed", "fixing", "running", "passed"]);
  });

  it("fails with GateFailedError and dispatches FixAttemptsExhausted after all attempts fail", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend, fakeTracer } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResult());
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "always fails" });

    const result = await Effect.runPromise(
      Effect.either(runGatesWithFixLoop(baseOpts).pipe(Effect.provide(layer))),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GateFailedError);
    }

    // After max attempts the loop dispatches FixAttemptsExhausted at least once
    // and lands the phase in `failed`.
    const dispositionTypes = fakeTracer.impl.events
      .filter((e) => e.event === "event.handled")
      .map((e) => e.details?.eventType);
    expect(dispositionTypes).toContain("FixAttemptsExhausted");

    const phaseTransitions = fakeTracer.impl.events
      .filter((e) => e.event === "state.transition")
      .map((e) => (e.details as { entity?: string; to?: string }).to);
    expect(phaseTransitions[phaseTransitions.length - 1]).toBe("failed");
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
