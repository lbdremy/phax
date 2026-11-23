import { Effect, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_PROVIDER_TIMEOUT_MS,
  runGates,
  serializeGateRequest,
  type AcceptanceGateStep,
} from "../../src/app/gates.js";
import { runGatesWithFixLoop } from "../../src/app/fixLoop.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { decodeBranchName, decodeClaudeSessionId } from "../../src/domain/branded.js";
import { acceptanceRequestPathFor } from "../../src/domain/gate/acceptanceRequest.js";
import { stepRecordPathFor } from "../../src/domain/gate/attemptFiles.js";
import { makeGateRequest, requestPathFor } from "../../src/domain/gate/gateRequest.js";
import { reportPathFor } from "../../src/domain/gate/reportPath.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import { Shell, type ShellOps, type ShellRunOptions } from "../../src/ports/shell.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import { currentSchemaUrl, readGateAttributionFile } from "../../src/schemas/persisted.js";
import type { GateAttribution } from "../../src/schemas/gateAttribution.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import {
  clockedFileSystemLayer,
  clockedGitLayer,
  clockedShellLayer,
  makeGateClock,
  type GateClock,
} from "../helpers/gateClock.js";

// The gate's times under a fixed clock (gate-step-times spec): the clock moves
// only inside the shell, file-system and git ports, so every recorded figure
// is exactly the advances that fell inside it.

const runPath = "/fake/runs/my-run";
const cwd = "/fake/worktrees/my-run/phase-01";
const phaseFolderPath = `${runPath}/phase-01`;
const phaseId = "phase-01";
const logPath = `${phaseFolderPath}/checks-attempt-01.log`;
const stepRecordPath = stepRecordPathFor(logPath);
const attributionPath = `${phaseFolderPath}/gate-attribution.json`;
const HOUR_MS = 3_600_000;

const gateRequest = serializeGateRequest(
  makeGateRequest({
    phaseId,
    base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    terminal: true,
    phases: [{ id: phaseId, plannedFilesToCreate: ["src/greet.ts"], plannedFilesToEdit: [] }],
  }),
);

function logStep(command: string, extra: Partial<GateStep> = {}): GateStep {
  return { command, surface: "local", firing: "every-phase", output: "log", ...extra };
}

function reportStep(command: string): GateStep {
  return { command, surface: "structural", firing: "every-phase", output: "gate-report" };
}

const checkedReport = (findings: ReadonlyArray<object> = []): string =>
  JSON.stringify({
    $schema: currentSchemaUrl("gate-report"),
    outcome: "checked",
    findings,
    review: [],
  });

const refusedReport = JSON.stringify({
  $schema: currentSchemaUrl("gate-report"),
  outcome: "refused",
  reason: "the checks need hw-rules 2, and 1 is installed",
  remedy: "pnpm add -D hw-rules@2",
});

const finding = {
  id: "no-node-import src/greet.ts node:fs",
  rule: "a module under src/ imports no node: module",
  location: { file: "src/greet.ts", lines: [1, 1] },
  message: "imports node:fs",
  related: [],
  guide: null,
};

interface Response {
  readonly exitCode?: number;
  readonly stdout?: string;
  /** The step's command fails to run, as a timeout or a spawn failure does. */
  readonly failure?: string;
  /** How far the clock moves while the command runs. */
  readonly ms: number;
}

interface GateCase {
  readonly steps: readonly GateStep[];
  readonly responses: Readonly<Record<string, Response>>;
  readonly acceptanceStep?: AcceptanceGateStep;
  /** How far the clock moves on a `writeAtomic` of each path. */
  readonly writes?: Readonly<Record<string, number>>;
}

function shellAdvance(
  responses: Readonly<Record<string, Response>>,
  scale: (ms: number) => number,
): (options: ShellRunOptions) => number {
  return (options) => scale(responses[options.command.join(" ")]?.ms ?? 0);
}

/** Runs one attempt of `gate` under `clock`, each advance passed through `scale`. */
async function runCase(
  gate: GateCase,
  clock: GateClock,
  scale: (ms: number) => number = (ms) => ms,
) {
  const fakeFs = makeFakeFileSystem();
  const fakeShell = makeFakeShell();
  for (const [command, response] of Object.entries(gate.responses)) {
    if (response.failure !== undefined) fakeShell.impl.setFailure(command, response.failure);
    else
      fakeShell.impl.setResponse(command, {
        exitCode: response.exitCode ?? 0,
        stdout: response.stdout ?? "",
        stderr: "",
      });
  }
  const writes = gate.writes ?? {};
  const layer = Layer.mergeAll(
    clockedFileSystemLayer(clock, fakeFs.layer, (path) => scale(writes[path] ?? 0)),
    clockedShellLayer(clock, fakeShell.layer, shellAdvance(gate.responses, scale)),
  );
  const result = await Effect.runPromise(
    Effect.result(
      clock.provide(
        runGates({
          steps: gate.steps,
          cwd,
          attemptLogPath: logPath,
          attributionPath,
          phaseId,
          gateRequest,
          ...(gate.acceptanceStep === undefined ? {} : { acceptanceStep: gate.acceptanceStep }),
        }).pipe(Effect.provide(layer)),
      ),
    ),
  );
  const recordText = fakeFs.impl.getFile(stepRecordPath)!;
  const attributionText = fakeFs.impl.getFile(attributionPath)!;
  return { result, fakeFs, fakeShell, recordText, attributionText };
}

/** The step record, decoded through phax's reader, after checking that the
 *  phase's gate-attribution.json holds the same bytes. */
function recorded(run: { recordText: string; attributionText: string }): GateAttribution {
  expect(run.attributionText).toBe(run.recordText);
  return decoded(run.recordText);
}

/** A step record's text, decoded through phax's reader. */
function decoded(text: string): GateAttribution {
  const read = readGateAttributionFile(stepRecordPath, JSON.parse(text) as unknown);
  if (Result.isFailure(read)) {
    throw new Error(`step record unreadable: ${JSON.stringify(read.failure)}`);
  }
  return read.success;
}

function measured(clock: GateClock, startedAtMs: number, durationMs: number) {
  return { kind: "measured", startedAt: clock.iso(startedAtMs), durationMs } as const;
}

describe("a gate attempt's times under a fixed clock", () => {
  it("records each step's start instant and duration, in step order (ac-step-times)", async () => {
    const clock = await makeGateClock();
    const t0 = clock.now();
    const run = await runCase(
      {
        steps: [logStep("pnpm format"), logStep("pnpm test"), logStep("pnpm lint")],
        responses: {
          "pnpm format": { ms: 700 },
          "pnpm test": { ms: 191_000 },
          "pnpm lint": { ms: 2400 },
        },
      },
      clock,
    );

    expect(Result.isSuccess(run.result)).toBe(true);
    const record = recorded(run);
    expect(record.steps).toEqual([
      { command: "pnpm format", surface: "local", result: "pass", time: measured(clock, t0, 700) },
      {
        command: "pnpm test",
        surface: "local",
        result: "pass",
        time: measured(clock, t0 + 700, 191_000),
      },
      {
        command: "pnpm lint",
        surface: "local",
        result: "pass",
        time: measured(clock, t0 + 191_700, 2400),
      },
    ]);
    expect(record.time).toEqual(measured(clock, t0, 194_100));
    expect(record.protectedPaths).toBeNull();
  });

  it("records the steps up to a failing one, the failing one measured, and no later step (ac-failing-step)", async () => {
    const clock = await makeGateClock();
    const t0 = clock.now();
    const run = await runCase(
      {
        steps: [logStep("pnpm format"), logStep("pnpm test"), logStep("pnpm lint")],
        responses: {
          "pnpm format": { ms: 700 },
          "pnpm test": { ms: 191_000, exitCode: 1 },
          "pnpm lint": { ms: 2400 },
        },
      },
      clock,
    );

    expect(Result.isFailure(run.result)).toBe(true);
    expect(run.fakeShell.impl.calls).toHaveLength(2);
    const record = recorded(run);
    expect(record.steps).toEqual([
      { command: "pnpm format", surface: "local", result: "pass", time: measured(clock, t0, 700) },
      {
        command: "pnpm test",
        surface: "local",
        result: "fail",
        time: measured(clock, t0 + 700, 191_000),
      },
    ]);
    expect(record.time).toEqual(measured(clock, t0, 191_700));
  });

  it("records a configured report step whose report refuses as refused, with its time (ac-refused-step)", async () => {
    const clock = await makeGateClock();
    const t0 = clock.now();
    const run = await runCase(
      {
        steps: [logStep("pnpm format"), reportStep("node ./audit.mjs")],
        responses: {
          "pnpm format": { ms: 700 },
          "node ./audit.mjs": { ms: 5300, stdout: refusedReport },
        },
      },
      clock,
    );

    expect(Result.isFailure(run.result)).toBe(true);
    expect(recorded(run).steps.at(-1)).toEqual({
      command: "node ./audit.mjs",
      surface: "structural",
      result: "refused",
      time: measured(clock, t0 + 700, 5300),
    });
  });

  it("records an acceptance step that outruns its cap as fail, lasting the cap (ac-acceptance-timeout)", async () => {
    const clock = await makeGateClock();
    const t0 = clock.now();
    const command = "node ./oracles.mjs";
    const run = await runCase(
      {
        steps: [logStep("pnpm test")],
        responses: {
          "pnpm test": { ms: 1000 },
          [command]: {
            ms: ACCEPTANCE_PROVIDER_TIMEOUT_MS,
            failure: `timed out after ${ACCEPTANCE_PROVIDER_TIMEOUT_MS}ms: ${command}`,
          },
        },
        acceptanceStep: {
          kind: "run",
          command,
          request: "{}",
          timeoutMs: ACCEPTANCE_PROVIDER_TIMEOUT_MS,
        },
        // Writing the acceptance request falls outside the step.
        writes: { [acceptanceRequestPathFor(logPath)]: 30 },
      },
      clock,
    );

    expect(Result.isFailure(run.result)).toBe(true);
    const record = recorded(run);
    expect(record.steps.at(-1)).toEqual({
      command,
      surface: "acceptance",
      result: "fail",
      time: measured(clock, t0 + 1030, ACCEPTANCE_PROVIDER_TIMEOUT_MS),
    });
    expect(record.time).toEqual(measured(clock, t0, 1030 + ACCEPTANCE_PROVIDER_TIMEOUT_MS));
  });

  it("records a skipped acceptance step as skipped, not run (ac-acceptance-skipped)", async () => {
    const clock = await makeGateClock();
    const t0 = clock.now();
    const run = await runCase(
      {
        steps: [logStep("pnpm test")],
        responses: { "pnpm test": { ms: 1000 } },
        acceptanceStep: { kind: "skipped", command: "node ./oracles.mjs" },
      },
      clock,
    );

    expect(Result.isSuccess(run.result)).toBe(true);
    const record = recorded(run);
    expect(record.steps).toEqual([
      { command: "pnpm test", surface: "local", result: "pass", time: measured(clock, t0, 1000) },
      {
        command: "node ./oracles.mjs",
        surface: "acceptance",
        result: "skipped",
        time: { kind: "not-run" },
      },
    ]);
    expect(record.time).toEqual(measured(clock, t0, 1000));
  });

  it("measures the attempt from before the request write to the last step's judgment (ac-attempt-time)", async () => {
    const clock = await makeGateClock();
    const t0 = clock.now();
    const run = await runCase(
      {
        steps: [
          logStep("node ./declare.mjs", { input: "gate-request" }),
          reportStep("node ./audit.mjs"),
          logStep("pnpm lint"),
        ],
        responses: {
          "node ./declare.mjs": { ms: 1000 },
          "node ./audit.mjs": { ms: 2000, stdout: checkedReport() },
          "pnpm lint": { ms: 300 },
        },
        writes: {
          // Inside the attempt, outside every step.
          [requestPathFor(logPath)]: 40,
          [reportPathFor(logPath, 2)]: 15,
          // After the attempt's end: in no figure.
          [logPath]: 7,
          [stepRecordPath]: 9,
        },
      },
      clock,
    );

    expect(Result.isSuccess(run.result)).toBe(true);
    const record = recorded(run);
    expect(record.steps.map((step) => step.time)).toEqual([
      measured(clock, t0 + 40, 1000),
      measured(clock, t0 + 1040, 2000),
      measured(clock, t0 + 3055, 300),
    ]);
    expect(record.time).toEqual(measured(clock, t0, 1000 + 2000 + 300 + 40 + 15));
    const first = record.steps.at(0)?.time;
    if (record.time.kind !== "measured" || first?.kind !== "measured") {
      throw new Error("unmeasured");
    }
    expect(Date.parse(record.time.startedAt)).toBeLessThanOrEqual(Date.parse(first.startedAt));
  });
});

// ── The fix loop ───────────────────────────────────────────────────────────

const sessionId = Result.getOrThrow(decodeClaudeSessionId("sess-abc123"));
const security: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open" },
  mcp: { mode: "provider-default", allow: [] },
  agentCommands: [],
  failClosed: false,
};

const protectedList = [{ glob: "**/steme.baseline.json", entry: "protectedPaths[0]" }];
const PROTECTED_FILE = "packages/a/steme.baseline.json";
const changedObservation = {
  entries: [{ status: "modified", path: PROTECTED_FILE }],
  tracked: [],
  untracked: [],
  links: [],
} as const;

interface LoopCase {
  readonly steps: readonly GateStep[];
  /** Each command's answers, one per run, in order; the last one repeats. */
  readonly responses: Readonly<Record<string, readonly Response[]>>;
  readonly maxFixAttempts: number;
  /** Declare a protected list; `changed` makes the worktree change a protected file. */
  readonly protectedPaths?: "unchanged" | "changed";
  /** How far the clock moves inside the worktree observation. */
  readonly observeMs?: number;
}

/** Runs the fix loop over `loop` under `clock`, each advance passed through `scale`. */
async function runLoop(
  loop: LoopCase,
  clock: GateClock,
  scale: (ms: number) => number = (ms) => ms,
) {
  const fakeFs = makeFakeFileSystem();
  const fakeShell = makeFakeShell();
  const fakeBackend = makeFakeBackend();
  const fakeGit = makeFakeGit();
  const fakeTelemetry = makeFakeSystemTelemetry();
  fakeFs.impl.setFile(
    `${phaseFolderPath}/status.json`,
    JSON.stringify(
      phaseStatusFile({
        phaseId,
        phaseIndex: 0,
        state: "running",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: "ai/my-run--phase-01",
        base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        createdAt: "2026-01-01T08:00:00.000Z",
        updatedAt: "2026-01-01T08:00:00.000Z",
      }),
    ),
  );
  fakeFs.impl.setFile(
    `${runPath}/run-status.json`,
    JSON.stringify({
      version: 1,
      namespace: "test-project",
      shortName: "my-run",
      runId: "my-run-2026-05-22",
      state: "running",
      createdAt: "2026-01-01T08:00:00.000Z",
      updatedAt: "2026-01-01T08:00:00.000Z",
      phasesCount: 1,
      currentPhaseIndex: 0,
    }),
  );
  for (let fix = 1; fix <= loop.maxFixAttempts; fix += 1) {
    fakeBackend.impl.addResumeResponse({
      sessionId: Result.getOrThrow(decodeClaudeSessionId(`sess-fixed-${fix}`)),
      outputPath: `${phaseFolderPath}/fix-attempt-0${fix}.jsonl`,
      finalText: "Fixed.",
    });
  }

  // Each run of a command takes its next answer; the last one repeats.
  const runs = new Map<string, number>();
  const nextAnswer = (command: string): Response => {
    const answers = loop.responses[command] ?? [{ ms: 0 }];
    return answers.at(Math.min(runs.get(command) ?? 0, answers.length - 1)) ?? { ms: 0 };
  };
  const scripted: ShellOps = {
    run: (options) => {
      const command = options.command.join(" ");
      const answer = nextAnswer(command);
      runs.set(command, (runs.get(command) ?? 0) + 1);
      fakeShell.impl.setResponse(command, {
        exitCode: answer.exitCode ?? 0,
        stdout: answer.stdout ?? "",
        stderr: "",
      });
      return fakeShell.impl.run(options);
    },
  };

  let base: string | null = null;
  if (loop.protectedPaths !== undefined) {
    base = await Effect.runPromise(
      fakeGit.impl.writeTreeCommit({
        repo: cwd,
        branch: Result.getOrThrow(decodeBranchName("base")),
        parent: null,
        expectedTip: null,
        message: "base",
        files: [{ path: PROTECTED_FILE, content: new TextEncoder().encode("{}\n") }],
      }),
    );
    if (loop.protectedPaths === "changed") fakeGit.impl.setObservation(cwd, changedObservation);
  }

  const layer = Layer.mergeAll(
    fakeFs.layer,
    clockedShellLayer(clock, Layer.succeed(Shell, scripted), (options) =>
      scale(nextAnswer(options.command.join(" ")).ms),
    ),
    fakeBackend.layer,
    clockedGitLayer(clock, fakeGit.layer, scale(loop.observeMs ?? 0)),
    fakeTelemetry.layer,
  );
  const result = await Effect.runPromise(
    Effect.result(
      clock.provide(
        runGatesWithFixLoop({
          steps: loop.steps,
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
          maxFixAttempts: loop.maxFixAttempts,
          run: "my-run",
          phaseId,
          runPath,
          gateRequest,
          protectedPaths: base === null ? null : { list: protectedList, base },
        }).pipe(Effect.provide(layer)),
      ),
    ),
  );
  const attemptLogs = [...fakeFs.impl.files.keys()]
    .filter((path) => /\/checks-attempt-\d+\.log$/.test(path))
    .toSorted();
  return { result, fakeFs, fakeBackend, attemptLogs };
}

/** A phase-folder file the fix loop wrote, as text. */
function phaseFile(run: { fakeFs: ReturnType<typeof makeFakeFileSystem> }, name: string): string {
  const text = run.fakeFs.impl.getFile(`${phaseFolderPath}/${name}`);
  if (text === undefined) throw new Error(`${name} was not written`);
  return text;
}

describe("the protected-paths check's time under a fixed clock", () => {
  it("records the check's 84 ms and keeps the step and attempt times (ac-protected-time)", async () => {
    const clock = await makeGateClock();
    const t0 = clock.now();
    const run = await runLoop(
      {
        steps: [logStep("pnpm format"), logStep("pnpm test")],
        responses: { "pnpm format": [{ ms: 700 }], "pnpm test": [{ ms: 1300 }] },
        maxFixAttempts: 1,
        protectedPaths: "unchanged",
        observeMs: 84,
      },
      clock,
    );

    expect(Result.isSuccess(run.result)).toBe(true);
    const recordText = phaseFile(run, "checks-attempt-01.attribution.json");
    expect(phaseFile(run, "gate-attribution.json")).toBe(recordText);
    const read = readGateAttributionFile(stepRecordPath, JSON.parse(recordText) as unknown);
    if (Result.isFailure(read)) throw new Error("step record unreadable");
    // The attempt ended at t0 + 2000, before the check began.
    expect(read.success).toEqual({
      phase: phaseId,
      time: measured(clock, t0, 2000),
      steps: [
        {
          command: "pnpm format",
          surface: "local",
          result: "pass",
          time: measured(clock, t0, 700),
        },
        {
          command: "pnpm test",
          surface: "local",
          result: "pass",
          time: measured(clock, t0 + 700, 1300),
        },
      ],
      protectedPaths: { result: "pass", changes: [], time: measured(clock, t0 + 2000, 84) },
    });
  });
});

// ── A verdict never depends on time (ac-no-decision) ────────────────────────

const still = (): number => 0;
const fast = (): number => 3 * HOUR_MS;

/** What a run decided, with every time left out: success, or the failure's
 *  class, its fields and the exit code phax would give it. */
function verdictOf(result: Result.Result<unknown, unknown>) {
  if (Result.isSuccess(result)) return { outcome: "success" } as const;
  const failure = result.failure;
  if (!(failure instanceof Error)) throw new Error("the run failed with a non-error");
  return {
    outcome: "failure",
    error: failure.constructor.name,
    message: failure.message,
    fields: Object.fromEntries(Object.entries(failure)),
    exitCode: exitCodeForError(failure),
  } as const;
}

/** Each step's command, surface and result, and the protected-paths verdict, without times. */
function stepResultsOf(text: string) {
  const record = decoded(text);
  const checked = record.protectedPaths;
  return {
    steps: record.steps.map(({ command, surface, result }) => ({ command, surface, result })),
    protectedPaths: checked === null ? null : { result: checked.result, changes: checked.changes },
  };
}

describe("a verdict under a still clock and under a fast one (ac-no-decision)", () => {
  const ORACLE = "node ./oracles.mjs";
  const gates: ReadonlyArray<readonly [string, GateCase]> = [
    [
      "every step passes",
      {
        steps: [logStep("pnpm format"), logStep("pnpm test"), logStep("pnpm lint")],
        responses: { "pnpm format": { ms: 1 }, "pnpm test": { ms: 1 }, "pnpm lint": { ms: 1 } },
      },
    ],
    [
      "the second step fails",
      {
        steps: [logStep("pnpm format"), logStep("pnpm test"), logStep("pnpm lint")],
        responses: {
          "pnpm format": { ms: 1 },
          "pnpm test": { ms: 1, exitCode: 1 },
          "pnpm lint": { ms: 1 },
        },
      },
    ],
    [
      "a report step reports a finding",
      {
        steps: [
          logStep("node ./declare.mjs", { input: "gate-request" }),
          reportStep("node ./audit.mjs"),
        ],
        responses: {
          "node ./declare.mjs": { ms: 1 },
          "node ./audit.mjs": { ms: 1, stdout: checkedReport([finding]) },
        },
      },
    ],
    [
      "a report step refuses",
      {
        steps: [reportStep("node ./audit.mjs")],
        responses: { "node ./audit.mjs": { ms: 1, stdout: refusedReport } },
      },
    ],
    [
      "the acceptance step times out",
      {
        steps: [logStep("pnpm test")],
        responses: {
          "pnpm test": { ms: 1 },
          [ORACLE]: { ms: 1, failure: `timed out after ${ACCEPTANCE_PROVIDER_TIMEOUT_MS}ms` },
        },
        acceptanceStep: {
          kind: "run",
          command: ORACLE,
          request: "{}",
          timeoutMs: ACCEPTANCE_PROVIDER_TIMEOUT_MS,
        },
      },
    ],
    [
      "the acceptance step is skipped",
      {
        steps: [logStep("pnpm test")],
        responses: { "pnpm test": { ms: 1 } },
        acceptanceStep: { kind: "skipped", command: ORACLE },
      },
    ],
  ];

  for (const [label, gate] of gates) {
    it(`gives the gate the same verdict when ${label}`, async () => {
      const slow = await runCase(gate, await makeGateClock(), still);
      const quick = await runCase(gate, await makeGateClock(), fast);

      expect(verdictOf(quick.result)).toEqual(verdictOf(slow.result));
      expect(stepResultsOf(quick.recordText)).toEqual(stepResultsOf(slow.recordText));
      // The fast clock did move: the two records differ in their times alone.
      expect(quick.recordText).not.toBe(slow.recordText);
    });
  }

  const loops: ReadonlyArray<readonly [string, LoopCase]> = [
    [
      "the first attempt passes",
      {
        steps: [logStep("pnpm test")],
        responses: { "pnpm test": [{ ms: 1 }] },
        maxFixAttempts: 1,
      },
    ],
    [
      "a fix makes the gate pass",
      {
        steps: [logStep("pnpm format"), logStep("pnpm test")],
        responses: {
          "pnpm format": [{ ms: 1 }],
          "pnpm test": [{ ms: 1, exitCode: 1 }, { ms: 1 }],
        },
        maxFixAttempts: 2,
      },
    ],
    [
      "the gate stays red",
      {
        steps: [logStep("pnpm test")],
        responses: { "pnpm test": [{ ms: 1, exitCode: 1 }] },
        maxFixAttempts: 2,
      },
    ],
    [
      "a step refuses",
      {
        steps: [reportStep("node ./audit.mjs")],
        responses: { "node ./audit.mjs": [{ ms: 1, stdout: refusedReport }] },
        maxFixAttempts: 2,
      },
    ],
    [
      "the attempt changes a protected path",
      {
        steps: [logStep("pnpm test")],
        responses: { "pnpm test": [{ ms: 1 }] },
        maxFixAttempts: 1,
        protectedPaths: "changed",
        observeMs: 1,
      },
    ],
  ];

  for (const [label, loop] of loops) {
    it(`gives the fix loop the same decisions when ${label}`, async () => {
      const slow = await runLoop(loop, await makeGateClock(), still);
      const quick = await runLoop(loop, await makeGateClock(), fast);

      expect(verdictOf(quick.result)).toEqual(verdictOf(slow.result));
      expect(quick.attemptLogs).toEqual(slow.attemptLogs);
      expect(quick.fakeBackend.impl.resumeCalls.length).toBe(
        slow.fakeBackend.impl.resumeCalls.length,
      );
      for (const log of slow.attemptLogs) {
        const name = stepRecordPathFor(log).slice(phaseFolderPath.length + 1);
        expect(stepResultsOf(phaseFile(quick, name))).toEqual(stepResultsOf(phaseFile(slow, name)));
      }
    });
  }
});
