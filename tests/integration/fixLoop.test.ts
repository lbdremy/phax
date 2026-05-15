import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { runGatesWithFixLoop } from "../../src/app/fixLoop.js";
import { GateFailedError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NoopTracerLayer } from "../../src/infra/tracer.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";

const cwd = "/fake/worktrees/my-run/phase-01";
const phaseFolderPath = "/fake/runs/my-run/phase-01";
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
};

function makeResumeResult(newSessionId = "sess-fixed") {
  return {
    sessionId: newSessionId as ClaudeSessionId,
    outputPath: `${phaseFolderPath}/fix-attempt-01.jsonl`,
    finalText: "Fixed.",
  };
}

describe("runGatesWithFixLoop", () => {
  it("succeeds immediately when gates pass on the first attempt", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    const fakeBackend = makeFakeBackend();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });
    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, phaseStatusJson);

    const outcome = await Effect.runPromise(
      runGatesWithFixLoop(baseOpts).pipe(
        Effect.provide(
          Layer.mergeAll(fakeFs.layer, fakeShell.layer, fakeBackend.layer, NoopTracerLayer),
        ),
      ),
    );

    expect(outcome.attemptLogPath).toContain("checks-attempt-01");
    expect(fakeBackend.impl.resumeCalls).toHaveLength(0);
  });

  it("calls resumeAgentSession on gate failure and succeeds on the second attempt", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    const fakeBackend = makeFakeBackend();

    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, phaseStatusJson);
    fakeBackend.impl.addResumeResponse(makeResumeResult());
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "", stderr: "test failure" },
      { exitCode: 0, stdout: "ok", stderr: "" },
    );

    const outcome = await Effect.runPromise(
      runGatesWithFixLoop(baseOpts).pipe(
        Effect.provide(
          Layer.mergeAll(fakeFs.layer, fakeShell.layer, fakeBackend.layer, NoopTracerLayer),
        ),
      ),
    );

    expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
    expect(outcome.attemptLogPath).toContain("checks-attempt-02");
  });

  it("fails with GateFailedError when gates keep failing after all fix attempts", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    const fakeBackend = makeFakeBackend();

    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, phaseStatusJson);
    fakeBackend.impl.addResumeResponse(makeResumeResult());
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "always fails" });

    const result = await Effect.runPromise(
      Effect.either(
        runGatesWithFixLoop(baseOpts).pipe(
          Effect.provide(
            Layer.mergeAll(fakeFs.layer, fakeShell.layer, fakeBackend.layer, NoopTracerLayer),
          ),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GateFailedError);
    }
  });

  it("includes gate output in the fix prompt sent to resumeAgentSession", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    const fakeBackend = makeFakeBackend();

    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, phaseStatusJson);
    fakeBackend.impl.addResumeResponse(makeResumeResult());
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "some stdout", stderr: "some stderr" },
      { exitCode: 0, stdout: "ok", stderr: "" },
    );

    await Effect.runPromise(
      runGatesWithFixLoop(baseOpts).pipe(
        Effect.provide(
          Layer.mergeAll(fakeFs.layer, fakeShell.layer, fakeBackend.layer, NoopTracerLayer),
        ),
      ),
    );

    expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
    const { prompt } = fakeBackend.impl.resumeCalls[0]!;
    expect(prompt).toContain("Gate checks failed");
    expect(prompt).toContain("pnpm test");
  });

  it("uses the session id from the fix result in the next gate attempt", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    const fakeBackend = makeFakeBackend();

    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, phaseStatusJson);
    fakeBackend.impl.addResumeResponse(makeResumeResult("sess-after-fix"));
    fakeBackend.impl.addResumeResponse(makeResumeResult("sess-after-fix-2"));
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "", stderr: "fail" },
      { exitCode: 0, stdout: "ok", stderr: "" },
    );

    await Effect.runPromise(
      runGatesWithFixLoop({ ...baseOpts, maxFixAttempts: 2 }).pipe(
        Effect.provide(
          Layer.mergeAll(fakeFs.layer, fakeShell.layer, fakeBackend.layer, NoopTracerLayer),
        ),
      ),
    );

    expect(fakeBackend.impl.resumeCalls[0]?.sessionId).toBe(sessionId);
  });
});
