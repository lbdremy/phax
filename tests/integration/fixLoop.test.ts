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

/** A made-up step record, as an attempt writes it beside its log. */
function stepRecord(
  steps: ReadonlyArray<{
    readonly command: string;
    readonly surface: string;
    readonly result: string;
  }>,
) {
  return JSON.stringify(
    { $schema: currentSchemaUrl("gate-attribution"), phase: "phase-01", steps },
    null,
    2,
  );
}

/** A made-up checked report from a step, with one finding per id (no line). */
function checkedReport(ids: readonly string[]) {
  return JSON.stringify({
    $schema: currentSchemaUrl("gate-report"),
    outcome: "checked",
    findings: ids.map((id) => ({
      id,
      rule: "a made-up rule",
      location: { file: "src/a.ts", lines: null },
      message: `found ${id}`,
      related: [],
      guide: null,
    })),
    review: [],
  });
}

/** The fix prompt's lines for a `checkedReport` finding marked `still failing`. */
function stillFailingLine(id: string) {
  return `- src/a.ts · still failing\n  rule: a made-up rule\n  found: found ${id}\n`;
}

/** Every file in the phase folder, by name. */
function phaseFiles(fakeFs: ReturnType<typeof makeFakeFileSystem>): ReadonlyMap<string, string> {
  const prefix = `${phaseFolderPath}/`;
  return new Map(
    [...fakeFs.impl.files]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, content]) => [path.slice(prefix.length), content]),
  );
}

/** Seeds the given phase-folder files and returns them, to check they stay unchanged. */
function seedPhaseFiles(
  fakeFs: ReturnType<typeof makeFakeFileSystem>,
  files: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  for (const [name, content] of Object.entries(files)) {
    fakeFs.impl.setFile(`${phaseFolderPath}/${name}`, content);
  }
  return new Map(Object.entries(files));
}

function expectUnchanged(
  fakeFs: ReturnType<typeof makeFakeFileSystem>,
  seeded: ReadonlyMap<string, string>,
) {
  const files = phaseFiles(fakeFs);
  for (const [name, content] of seeded) expect(files.get(name)).toBe(content);
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

function scriptStep(command: string, output: "log" | "gate-report") {
  return { command, surface: "structural", firing: "every-phase", output } as const;
}

/** Seeds a previous attempt 02 in which `node scripts/a.mjs` passed and
 *  `node scripts/b.mjs` printed `report`, after an attempt 01. */
function seedPrevious(
  fakeFs: ReturnType<typeof makeFakeFileSystem>,
  report: string,
  result: "fail" | "refused",
) {
  return seedPhaseFiles(fakeFs, {
    "checks-attempt-01.log": "$ node scripts/a.mjs\nexit 1\n",
    "checks-attempt-01.attribution.json": stepRecord([
      { command: "node scripts/a.mjs", surface: "structural", result: "fail" },
    ]),
    "checks-attempt-02.log": "$ node scripts/a.mjs\nok\nexit 0\n",
    "checks-attempt-02.attribution.json": stepRecord([
      { command: "node scripts/a.mjs", surface: "structural", result: "pass" },
      { command: "node scripts/b.mjs", surface: "structural", result },
    ]),
    "checks-attempt-02.report-02.json": report,
  });
}

/** Runs the gate as attempt 03 over `steps` and returns the first fix prompt. */
async function firstFixPrompt(
  { layer, fakeFs, fakeBackend }: ReturnType<typeof makeLayers>,
  steps: ReadonlyArray<ReturnType<typeof scriptStep>>,
) {
  fakeBackend.impl.addResumeResponse(makeResumeResult());
  await Effect.runPromise(runGatesWithFixLoop({ ...baseOpts, steps }).pipe(Effect.provide(layer)));
  expect(phaseFiles(fakeFs).has("checks-attempt-03.log")).toBe(true);
  return fakeBackend.impl.resumeCalls[0]!.prompt;
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
        fakeFs.impl.setFile(
          `${phaseFolderPath}/checks-attempt-02.attribution.json`,
          stepRecord([{ command: "node ./audit.mjs", surface: "structural", result: "fail" }]),
        );
        fakeFs.impl.setFile(`${phaseFolderPath}/checks-attempt-02.report-01.json`, attempt1);
        fakeBackend.impl.addResumeResponse(makeResumeResult());
        fakeShell.impl.enqueue(
          { exitCode: 1, stdout: attempt2, stderr: "" },
          { exitCode: 0, stdout: passingReport, stderr: "" },
        );

        await Effect.runPromise(
          runGatesWithFixLoop({ ...baseOpts, steps: reportStep }).pipe(Effect.provide(layer)),
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
          fakeFs.impl.setFile(`${phaseFolderPath}/checks-attempt-02.log`, "$ node ./audit.mjs");
          fakeFs.impl.setFile(
            `${phaseFolderPath}/checks-attempt-02.attribution.json`,
            stepRecord([{ command: "node ./audit.mjs", surface: "structural", result: "fail" }]),
          );
          fakeFs.impl.setFile(`${phaseFolderPath}/checks-attempt-02.report-01.json`, saved);
          fakeBackend.impl.addResumeResponse(makeResumeResult());
          fakeShell.impl.enqueue(
            { exitCode: 1, stdout: attempt2, stderr: "" },
            { exitCode: 0, stdout: passingReport, stderr: "" },
          );

          await Effect.runPromise(
            runGatesWithFixLoop({ ...baseOpts, steps: reportStep }).pipe(Effect.provide(layer)),
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

  describe("attempt numbering", () => {
    // A made-up first entry's files: attempts 01 and 02 failed, each followed
    // by a fix attempt.
    const earlierEntry = {
      "checks-attempt-01.log": "$ pnpm test\nfail 1\nexit 1\n",
      "checks-attempt-01.attribution.json": stepRecord([
        { command: "pnpm test", surface: "local", result: "fail" },
      ]),
      "fix-attempt-01.jsonl": '{"type":"result"}\n',
      "checks-attempt-02.log": "$ pnpm test\nfail 2\nexit 1\n",
      "checks-attempt-02.attribution.json": stepRecord([
        { command: "pnpm test", surface: "local", result: "fail" },
      ]),
      "fix-attempt-02.jsonl": '{"type":"result"}\n',
    };

    it("continues above an earlier entry's attempts and leaves their files unchanged", async () => {
      const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
      fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });
      seedStatusFiles(fakeFs);
      const seeded = seedPhaseFiles(fakeFs, earlierEntry);

      const outcome = await Effect.runPromise(
        runGatesWithFixLoop(baseOpts).pipe(Effect.provide(layer)),
      );

      expect(outcome.attemptLogPath).toBe(`${phaseFolderPath}/checks-attempt-03.log`);
      expect(fakeBackend.impl.resumeCalls).toHaveLength(0);
      expectUnchanged(fakeFs, seeded);
    });

    it("grants a fresh fix budget on a re-entry and numbers each attempt above the last", async () => {
      const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
      seedStatusFiles(fakeFs);
      const seeded = seedPhaseFiles(fakeFs, earlierEntry);
      fakeBackend.impl.addResumeResponse(makeResumeResult("sess-resume-fix"));
      fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "still fails" });

      const result = await Effect.runPromise(
        Effect.either(runGatesWithFixLoop(baseOpts).pipe(Effect.provide(layer))),
      );

      // maxFixAttempts=1: gate 03 fails → one fix → gate 04 fails → exhausted.
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(GateAttemptsExhaustedError);
        expect((result.left as GateAttemptsExhaustedError).attempt).toBe(4);
      }
      expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
      expect(fakeBackend.impl.resumeCalls[0]!.options.outputJsonlPath).toBe(
        `${phaseFolderPath}/fix-attempt-03.jsonl`,
      );
      expect(fakeBackend.impl.resumeCalls[0]!.prompt).toContain("(attempt 3)");
      expect(phaseFiles(fakeFs).has("checks-attempt-03.log")).toBe(true);
      expect(phaseFiles(fakeFs).has("checks-attempt-04.log")).toBe(true);
      expectUnchanged(fakeFs, seeded);
    });

    it("skips past a cut-short attempt, which is never the previous one", async () => {
      const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
      seedStatusFiles(fakeFs);
      const steps = [
        {
          command: "node scripts/audit.mjs",
          surface: "structural",
          firing: "every-phase",
          output: "gate-report",
        },
      ] as const;
      const seeded = seedPhaseFiles(fakeFs, {
        "checks-attempt-03.log":
          "$ node scripts/audit.mjs\nreport: checks-attempt-03.report-01.json",
        "checks-attempt-03.attribution.json": stepRecord([
          { command: "node scripts/audit.mjs", surface: "structural", result: "fail" },
        ]),
        "checks-attempt-03.report-01.json": checkedReport(["no-node-import:src/a.ts"]),
        // Attempt 04 was cut short: its report was saved, its log never was.
        "checks-attempt-04.request.json": gateRequest,
        "checks-attempt-04.report-01.json": checkedReport(["x-4"]),
      });
      fakeBackend.impl.addResumeResponse(makeResumeResult());
      fakeShell.impl.enqueue(
        { exitCode: 1, stdout: checkedReport(["no-node-import:src/a.ts", "x-4"]), stderr: "" },
        { exitCode: 0, stdout: checkedReport([]), stderr: "" },
      );

      const outcome = await Effect.runPromise(
        runGatesWithFixLoop({ ...baseOpts, steps }).pipe(Effect.provide(layer)),
      );

      expect(outcome.attemptLogPath).toBe(`${phaseFolderPath}/checks-attempt-06.log`);
      expect(phaseFiles(fakeFs).has("checks-attempt-05.log")).toBe(true);
      const prompt = fakeBackend.impl.resumeCalls[0]!.prompt;
      expect(prompt).toContain("(attempt 5)");
      // The previous recorded attempt is 03: its finding is marked, 04's is not.
      expect(prompt).toContain(stillFailingLine("no-node-import:src/a.ts"));
      expect(prompt.split("still failing")).toHaveLength(2);
      expectUnchanged(fakeFs, seeded);
    });

    it("reads numbers of any digit count", async () => {
      const { layer, fakeFs, fakeShell } = makeLayers();
      fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "ok", stderr: "" });
      seedStatusFiles(fakeFs);
      const seeded = seedPhaseFiles(fakeFs, { "checks-attempt-100.log": "$ pnpm test\nexit 1\n" });

      const outcome = await Effect.runPromise(
        runGatesWithFixLoop(baseOpts).pipe(Effect.provide(layer)),
      );

      expect(outcome.attemptLogPath).toBe(`${phaseFolderPath}/checks-attempt-101.log`);
      expectUnchanged(fakeFs, seeded);
    });

    it("gives one attempt's files one number: log, request, report, step record and fix transcript", async () => {
      const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
      seedStatusFiles(fakeFs);
      seedPhaseFiles(fakeFs, earlierEntry);
      fakeBackend.impl.addResumeResponse(makeResumeResult());
      fakeShell.impl.enqueue(
        { exitCode: 0, stdout: "ok", stderr: "" },
        { exitCode: 1, stdout: checkedReport(["x-1"]), stderr: "" },
        { exitCode: 0, stdout: "ok", stderr: "" },
        { exitCode: 0, stdout: checkedReport([]), stderr: "" },
      );

      await Effect.runPromise(
        runGatesWithFixLoop({
          ...baseOpts,
          steps: [
            ...baseOpts.steps,
            {
              command: "node scripts/audit.mjs",
              surface: "structural",
              firing: "every-phase",
              output: "gate-report",
              input: "gate-request",
            },
          ],
        }).pipe(Effect.provide(layer)),
      );

      const attempt03 = [...phaseFiles(fakeFs).keys()].filter((name) =>
        name.startsWith("checks-attempt-03."),
      );
      expect(attempt03.toSorted()).toEqual([
        "checks-attempt-03.attribution.json",
        "checks-attempt-03.log",
        "checks-attempt-03.report-02.json",
        "checks-attempt-03.request.json",
      ]);
      expect(fakeBackend.impl.resumeCalls[0]!.options.outputJsonlPath).toBe(
        `${phaseFolderPath}/fix-attempt-03.jsonl`,
      );
    });
  });

  describe("still failing, keyed by command", () => {
    const a = scriptStep("node scripts/a.mjs", "log");
    const b = scriptStep("node scripts/b.mjs", "gate-report");
    const c = scriptStep("node scripts/c.mjs", "gate-report");
    const ok = { exitCode: 0, stdout: "ok", stderr: "" };

    it("marks a finding the same command listed in the previous attempt, across a re-entry", async () => {
      const layers = makeLayers();
      const { fakeFs, fakeShell } = layers;
      seedStatusFiles(fakeFs);
      const seeded = seedPrevious(fakeFs, checkedReport(["no-node-import:src/a.ts"]), "fail");
      fakeShell.impl.enqueue(
        ok,
        { exitCode: 1, stdout: checkedReport(["no-node-import:src/a.ts", "x-2"]), stderr: "" },
        ok,
        { exitCode: 0, stdout: checkedReport([]), stderr: "" },
      );

      const prompt = await firstFixPrompt(layers, [a, b]);

      expect(prompt).toContain(stillFailingLine("no-node-import:src/a.ts"));
      expect(prompt.split("still failing")).toHaveLength(2);
      expectUnchanged(fakeFs, seeded);
    });

    it("marks nothing for an inserted step at the previous step's position", async () => {
      const layers = makeLayers();
      const { fakeFs, fakeShell } = layers;
      seedStatusFiles(fakeFs);
      seedPrevious(fakeFs, checkedReport(["x-1"]), "fail");
      fakeShell.impl.enqueue(
        ok,
        { exitCode: 1, stdout: checkedReport(["x-1"]), stderr: "" },
        ok,
        { exitCode: 0, stdout: checkedReport([]), stderr: "" },
        { exitCode: 0, stdout: checkedReport([]), stderr: "" },
      );

      const prompt = await firstFixPrompt(layers, [a, c, b]);

      expect(prompt).toContain("**Failed step:** `node scripts/c.mjs` (1 finding)");
      expect(prompt).not.toContain("still failing");
    });

    it("marks a finding of a step that moved to another position", async () => {
      const layers = makeLayers();
      const { fakeFs, fakeShell } = layers;
      seedStatusFiles(fakeFs);
      seedPrevious(fakeFs, checkedReport(["x-1"]), "fail");
      fakeShell.impl.enqueue(
        { exitCode: 1, stdout: checkedReport(["x-1"]), stderr: "" },
        { exitCode: 0, stdout: checkedReport([]), stderr: "" },
        ok,
      );

      const prompt = await firstFixPrompt(layers, [b, a]);

      expect(prompt).toContain("**Failed step:** `node scripts/b.mjs` (1 finding)");
      expect(prompt).toContain(stillFailingLine("x-1"));
    });

    it("marks nothing when the same command's previous report was refused", async () => {
      const layers = makeLayers();
      const { fakeFs, fakeShell } = layers;
      seedStatusFiles(fakeFs);
      seedPrevious(
        fakeFs,
        JSON.stringify({
          $schema: currentSchemaUrl("gate-report"),
          outcome: "refused",
          reason: "no base",
          remedy: "fetch the base",
        }),
        "refused",
      );
      fakeShell.impl.enqueue(ok, { exitCode: 1, stdout: checkedReport(["x-1"]), stderr: "" }, ok, {
        exitCode: 0,
        stdout: checkedReport([]),
        stderr: "",
      });

      const prompt = await firstFixPrompt(layers, [a, b]);

      expect(prompt).not.toContain("still failing");
    });

    it("marks nothing over a folder written before step records, and changes none of it", async () => {
      const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();
      seedStatusFiles(fakeFs);
      const seeded = seedPhaseFiles(fakeFs, {
        "checks-attempt-01.log": "$ node scripts/b.mjs\nexit 1\n",
        "checks-attempt-01.report-01.json": checkedReport(["x-1"]),
        "fix-attempt-01.jsonl": '{"type":"result"}\n',
        "checks-attempt-02.log": "$ node scripts/b.mjs\nexit 1\n",
        "checks-attempt-02.report-01.json": checkedReport(["x-1"]),
        "fix-attempt-02.jsonl": '{"type":"result"}\n',
        "checks-attempt-03.log": "$ node scripts/b.mjs\nexit 1\n",
        "checks-attempt-03.report-01.json": checkedReport(["x-1"]),
      });
      // The per-phase gate-attribution.json is no step record: never read for
      // the mark, and rewritten by every attempt as before.
      fakeFs.impl.setFile(
        `${phaseFolderPath}/gate-attribution.json`,
        stepRecord([{ command: "node scripts/b.mjs", surface: "structural", result: "fail" }]),
      );
      fakeBackend.impl.addResumeResponse(makeResumeResult());
      fakeShell.impl.enqueue(
        { exitCode: 1, stdout: checkedReport(["x-1"]), stderr: "" },
        { exitCode: 0, stdout: checkedReport([]), stderr: "" },
      );

      const outcome = await Effect.runPromise(
        runGatesWithFixLoop({ ...baseOpts, steps: [b] }).pipe(Effect.provide(layer)),
      );

      expect(phaseFiles(fakeFs).has("checks-attempt-04.log")).toBe(true);
      expect(outcome.attemptLogPath).toBe(`${phaseFolderPath}/checks-attempt-05.log`);
      expect(fakeBackend.impl.resumeCalls[0]!.prompt).not.toContain("still failing");
      expectUnchanged(fakeFs, seeded);
    });
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

  it("numbers a first entry's attempts from 01: checks-attempt-01, then attempt-02 after one fix", async () => {
    const { layer, fakeFs, fakeShell, fakeBackend } = makeLayers();

    seedStatusFiles(fakeFs);
    fakeBackend.impl.addResumeResponse(makeResumeResult());
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "", stderr: "fail once" },
      { exitCode: 0, stdout: "ok", stderr: "" },
    );

    const outcome = await Effect.runPromise(
      runGatesWithFixLoop(baseOpts).pipe(Effect.provide(layer)),
    );

    expect(outcome.attemptLogPath).toContain("checks-attempt-02");
    expect(fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-01.log`)).toBeDefined();
    expect(fakeFs.impl.getFile(`${phaseFolderPath}/checks-attempt-02.log`)).toBeDefined();
  });
});
