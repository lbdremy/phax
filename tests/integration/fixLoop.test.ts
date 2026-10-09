import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { runGatesWithFixLoop } from "../../src/app/fixLoop.js";
import { serializeGateRequest } from "../../src/app/gates.js";
import { makeGateRequest } from "../../src/domain/gate/gateRequest.js";
import { GateAttemptsExhaustedError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";

const runPath = "/fake/runs/my-run";
const cwd = "/fake/worktrees/my-run/phase-01";
const phaseFolderPath = `${runPath}/phase-01`;
const sessionId = "sess-abc123" as ClaudeSessionId;

const phaseStatusJson = JSON.stringify({
  $schema: currentSchemaUrl("phase-status"),
  phaseId: "phase-01",
  phaseIndex: 0,
  state: "running",
  model: "claude-sonnet-4-6",
  effort: "low",
  branchName: "ai/my-run--phase-01",
  base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
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

// A made-up gate request; only declaring steps ever see it.
const gateRequest = serializeGateRequest(
  makeGateRequest({
    phaseId: "phase-01",
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    terminal: true,
    phases: [{ id: "phase-01", plannedFilesToCreate: ["src/greet.ts"], plannedFilesToEdit: [] }],
  }),
);

const security: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open" },
  mcp: { mode: "provider-default", allow: [] },
  agentCommands: [],
  failClosed: false,
};

const baseOpts = {
  steps: [
    { command: "pnpm test", surface: "local", firing: "every-phase", output: "log" },
  ] as const,
  cwd,
  phaseFolderPath,
  sessionId,
  agentOptions: {
    provider: "claude-code" as const,
    model: "claude-sonnet-4-6",
    effort: "medium",
    cwd,
    security,
    phaseFolderPath,
  },
  maxFixAttempts: 1,
  run: "my-run",
  phaseId: "phase-01",
  runPath,
  gateRequest,
};

/** The spec's made-up node:fs finding in src/greet.ts, at the given line. */
function greetFs(line: number) {
  return {
    id: "no-node-import src/greet.ts node:fs",
    rule: "a module under src/ imports no node: module",
    location: { file: "src/greet.ts", lines: [line, line] },
    message: "imports node:fs",
    related: [],
    guide: { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" },
  };
}

/** The spec's made-up finding for a module with no exported function. */
function exportsFunction(file: string) {
  return {
    id: `exports-function ${file}`,
    rule: "a module under src/ exports its function",
    location: { file, lines: null },
    message: "no exported function",
    related: [],
    guide: null,
  };
}

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

  describe("a report step", () => {
    const reportUrl = currentSchemaUrl("gate-report");
    const reportStep = [
      {
        command: "node ./audit.mjs",
        surface: "structural",
        firing: "every-phase",
        output: "gate-report",
      },
    ] as const;
    const passingReport = JSON.stringify({
      $schema: reportUrl,
      outcome: "checked",
      findings: [],
      review: [],
    });

    it("spends one fix attempt on the raw-log prompt for a broken step", async () => {
      const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
      seedStatusFiles(fakeFs);
      fakeBackend.impl.addResumeResponse(makeResumeResult());
      fakeShell.impl.enqueue(
        { exitCode: 1, stdout: "not json", stderr: "audit crashed" },
        { exitCode: 0, stdout: passingReport, stderr: "" },
      );

      const outcome = await Effect.runPromise(
        runGatesWithFixLoop({ ...baseOpts, steps: reportStep }).pipe(Effect.provide(layer)),
      );

      expect(outcome.attemptLogPath).toContain("checks-attempt-02");
      expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
      const { prompt } = fakeBackend.impl.resumeCalls[0]!;
      expect(prompt).toContain("## Gate output");
      expect(prompt).toContain("**Failed command:** `node ./audit.mjs`");
      expect(prompt).toContain(`provider error: stdout is not JSON`);
      expect(prompt).not.toContain("## Findings");
    });

    it("lists a failing report's findings in the fix prompt, and nothing else from it", async () => {
      const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
      seedStatusFiles(fakeFs);
      fakeBackend.impl.addResumeResponse(makeResumeResult());
      const failingReport = JSON.stringify({
        $schema: reportUrl,
        outcome: "checked",
        findings: [
          {
            id: "no-node-import src/greet.ts node:fs",
            rule: "a module under src/ imports no node: module",
            location: { file: "src/greet.ts", lines: [1, 1] },
            message: "imports node:fs",
            related: [],
            guide: { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" },
          },
        ],
        review: [{ owner: "hw-maintainers", note: "whether the greeting reads well" }],
      });
      fakeShell.impl.enqueue(
        { exitCode: 0, stdout: failingReport, stderr: "" },
        { exitCode: 0, stdout: passingReport, stderr: "" },
      );

      await Effect.runPromise(
        runGatesWithFixLoop({ ...baseOpts, steps: reportStep }).pipe(Effect.provide(layer)),
      );

      expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
      const { prompt } = fakeBackend.impl.resumeCalls[0]!;
      expect(prompt).toContain("**Failed step:** `node ./audit.mjs` (1 finding)");
      expect(prompt).toContain("- src/greet.ts:1");
      expect(prompt).toContain("found: imports node:fs");
      expect(prompt).toContain("Read guides/no-node-import.md and follow it.");
      expect(prompt).not.toContain("no-node-import src/greet.ts node:fs");
      expect(prompt).not.toContain("hw-maintainers");
      expect(prompt).not.toContain("whether the greeting reads well");
      expect(prompt).not.toContain("## Gate output");
    });

    it("lists a failing report's findings in the fix prompt in report order", async () => {
      const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
      seedStatusFiles(fakeFs);
      fakeBackend.impl.addResumeResponse(makeResumeResult());
      const twoFindings = JSON.stringify({
        $schema: reportUrl,
        outcome: "checked",
        findings: [
          {
            id: "no-console src/index.ts",
            rule: "no-console",
            location: { file: "src/index.ts", lines: [12, 12] },
            message: "Unexpected console statement",
            related: [],
            guide: null,
          },
          {
            id: "missing-wiring src/core/billing/port.ts",
            rule: "missing-wiring",
            location: { file: "src/core/billing/port.ts", lines: null },
            message: "billing port is not wired up",
            related: [],
            guide: null,
          },
        ],
        review: [],
      });
      fakeShell.impl.enqueue(
        { exitCode: 1, stdout: twoFindings, stderr: "" },
        { exitCode: 0, stdout: passingReport, stderr: "" },
      );

      await Effect.runPromise(
        runGatesWithFixLoop({ ...baseOpts, steps: reportStep }).pipe(Effect.provide(layer)),
      );

      expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
      const { prompt } = fakeBackend.impl.resumeCalls[0]!;
      expect(prompt).toContain("**Failed step:** `node ./audit.mjs` (2 findings)");
      const findingsSection = prompt.slice(
        prompt.indexOf("## Findings"),
        prompt.indexOf("## Required action"),
      );
      expect(findingsSection.indexOf("no-console")).toBeGreaterThan(-1);
      expect(findingsSection.indexOf("missing-wiring")).toBeGreaterThan(
        findingsSection.indexOf("no-console"),
      );
      expect(prompt).not.toMatch(/pending|optional/i);
    });

    describe("still failing, by id alone", () => {
      const failing = (findings: ReadonlyArray<object>) =>
        JSON.stringify({ $schema: reportUrl, outcome: "checked", findings, review: [] });
      const attempt1 = failing([greetFs(1), exportsFunction("src/greet.ts")]);
      const attempt2 = failing([greetFs(4), exportsFunction("src/farewell.ts")]);

      it("marks the finding whose id the same step listed in the previous attempt, wherever it now is", async () => {
        const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
        seedStatusFiles(fakeFs);
        fakeBackend.impl.addResumeResponse(makeResumeResult("sess-fix-1"));
        fakeBackend.impl.addResumeResponse(makeResumeResult("sess-fix-2"));
        fakeShell.impl.enqueue(
          { exitCode: 1, stdout: attempt1, stderr: "" },
          { exitCode: 1, stdout: attempt2, stderr: "" },
          { exitCode: 0, stdout: passingReport, stderr: "" },
        );

        await Effect.runPromise(
          runGatesWithFixLoop({ ...baseOpts, steps: reportStep, maxFixAttempts: 2 }).pipe(
            Effect.provide(layer),
          ),
        );

        expect(fakeBackend.impl.resumeCalls).toHaveLength(2);
        expect(fakeBackend.impl.resumeCalls[0]!.prompt).not.toContain("still failing");
        const prompt = fakeBackend.impl.resumeCalls[1]!.prompt;
        expect(prompt).toContain("- src/greet.ts:4 · still failing\n");
        expect(prompt).toContain("- src/farewell.ts\n");
        expect(prompt.split("still failing")).toHaveLength(2);
        expect(prompt).not.toContain("exports-function src/greet.ts");
        expect(prompt).not.toMatch(/\bfixed\b/i);
      });

      it("marks nothing when the previous attempt failed on a step that ran before the report step", async () => {
        const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
        seedStatusFiles(fakeFs);
        fakeBackend.impl.addResumeResponse(makeResumeResult("sess-fix-1"));
        fakeBackend.impl.addResumeResponse(makeResumeResult("sess-fix-2"));
        fakeShell.impl.enqueue(
          { exitCode: 1, stdout: "", stderr: "test failure" },
          { exitCode: 0, stdout: "ok", stderr: "" },
          { exitCode: 1, stdout: attempt2, stderr: "" },
          { exitCode: 0, stdout: "ok", stderr: "" },
          { exitCode: 0, stdout: passingReport, stderr: "" },
        );

        await Effect.runPromise(
          runGatesWithFixLoop({
            ...baseOpts,
            steps: [...baseOpts.steps, ...reportStep],
            maxFixAttempts: 2,
          }).pipe(Effect.provide(layer)),
        );

        expect(fakeBackend.impl.resumeCalls).toHaveLength(2);
        const prompt = fakeBackend.impl.resumeCalls[1]!.prompt;
        expect(prompt).toContain("**Failed step:** `node ./audit.mjs` (2 findings)");
        expect(prompt).not.toContain("still failing");
      });

      it("marks across a resume, from the previous attempt's saved report", async () => {
        const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
        seedStatusFiles(fakeFs);
        fakeFs.impl.setFile(`${phaseFolderPath}/checks-attempt-02.log`, "$ node ./audit.mjs");
        fakeFs.impl.setFile(`${phaseFolderPath}/checks-attempt-02.report-01.json`, attempt1);
        fakeBackend.impl.addResumeResponse(makeResumeResult());
        fakeShell.impl.enqueue(
          { exitCode: 1, stdout: attempt2, stderr: "" },
          { exitCode: 0, stdout: passingReport, stderr: "" },
        );

        await Effect.runPromise(
          runGatesWithFixLoop({ ...baseOpts, steps: reportStep, startAttempt: 3 }).pipe(
            Effect.provide(layer),
          ),
        );

        expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
        expect(fakeBackend.impl.resumeCalls[0]!.prompt).toContain(
          "- src/greet.ts:4 · still failing\n",
        );
      });

      it("marks nothing when the previous attempt's report is unreadable or refused", async () => {
        for (const saved of [
          "not json",
          JSON.stringify({ $schema: reportUrl, outcome: "refused", reason: "r", remedy: "m" }),
        ]) {
          const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
          seedStatusFiles(fakeFs);
          fakeFs.impl.setFile(`${phaseFolderPath}/checks-attempt-02.report-01.json`, saved);
          fakeBackend.impl.addResumeResponse(makeResumeResult());
          fakeShell.impl.enqueue(
            { exitCode: 1, stdout: attempt2, stderr: "" },
            { exitCode: 0, stdout: passingReport, stderr: "" },
          );

          await Effect.runPromise(
            runGatesWithFixLoop({ ...baseOpts, steps: reportStep, startAttempt: 3 }).pipe(
              Effect.provide(layer),
            ),
          );

          expect(fakeBackend.impl.resumeCalls[0]!.prompt).not.toContain("still failing");
        }
      });
    });
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

  it("hands a declaring step the same request bytes on every attempt", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResult("sess-fix-1"));
    fakeBackend.impl.addResumeResponse(makeResumeResult("sess-fix-2"));
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "", stderr: "fail 1" },
      { exitCode: 1, stdout: "", stderr: "fail 2" },
      { exitCode: 0, stdout: "ok", stderr: "" },
    );

    await Effect.runPromise(
      runGatesWithFixLoop({
        ...baseOpts,
        steps: [
          {
            command: "node ./audit.mjs",
            surface: "structural",
            firing: "every-phase",
            output: "log",
            input: "gate-request",
          },
        ],
        maxFixAttempts: 2,
      }).pipe(Effect.provide(layer)),
    );

    const requests = [1, 2, 3].map((attempt) =>
      fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-0${attempt}.request.json`),
    );
    expect(requests).toEqual([gateRequest, gateRequest, gateRequest]);
    expect(fakeShell.impl.calls.map((call) => call.stdin)).toEqual([
      gateRequest,
      gateRequest,
      gateRequest,
    ]);
  });

  it("gate-attribution.json reflects the final attempt, not intermediate failures", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResult());
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "", stderr: "test failure" },
      { exitCode: 0, stdout: "ok", stderr: "" },
    );

    await Effect.runPromise(runGatesWithFixLoop(baseOpts).pipe(Effect.provide(layer)));

    const raw = fakeFs.impl.getFile(`${phaseFolderPath}/gate-attribution.json`);
    expect(raw).toBeDefined();
    const record = JSON.parse(raw!) as { phase: string; steps: unknown[] };
    expect(record.phase).toBe("phase-01");
    expect(record.steps).toEqual([{ command: "pnpm test", surface: "local", result: "pass" }]);
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
