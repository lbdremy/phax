import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Deferred, Effect, Either, Fiber, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDeclaredStop, type CloseReport } from "../../src/app/closeStop.js";
import { dispatch } from "../../src/app/dispatcher.js";
import { buildInteractiveCommitBody } from "../../src/app/commit.js";
import { readInteractiveSession } from "../../src/app/interactiveFiles.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import type { ClaudeSessionId, PhaseId, RunId } from "../../src/domain/branded.js";
import { StopCloseRefusedError, type RefusedClose } from "../../src/domain/errors.js";
import {
  REVIEWED_WITHOUT_CHANGE_HANDOFF,
  renderInteractiveHandoff,
} from "../../src/domain/interactive/handoff.js";
import { PERSON_HANDOFF_PATH } from "../../src/domain/interactive/worktreeChange.js";
import { FakeBackendImpl, makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend, type AgentRunOptions, type AgentRunResult } from "../../src/ports/backend.js";
import { FsError } from "../../src/ports/fs.js";
import { Git, type GitOps } from "../../src/ports/git.js";
import { Session } from "../../src/ports/session.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { InteractiveHandoff } from "../../src/schemas/interactiveHandoff.js";
import {
  createWorld,
  readJson,
  resolvedConfig,
  stopRun,
  type StoppedRun,
  type World,
} from "../helpers/stoppedRunFixture.js";

// The made-up invoice-export run stopped at its interactive phase-03 by the
// real stop, then closed through `closeDeclaredStop`: real git (a linked
// worktree), the real file system, a fake backend playing the provider, and a
// shell whose `pnpm` gate steps are scripted while git runs for real.

const sessionLayer = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/infra/session.js", () => ({
  makeNodeSessionLayer: () => sessionLayer.current,
}));
// No test reads ~/.phax: providers.json is the built-in catalog.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const { Effect: E } = await import("effect");
  const { DEFAULT_PROVIDER_CONFIG: defaults } =
    await import("../../src/domain/routing/defaults.js");
  return { ...original, loadProviderConfig: () => E.succeed(defaults) };
});

const SESSION_X1 = "X1" as ClaudeSessionId;

const PHASE_03: PhaxPlanPhase = {
  id: "phase-03",
  title: "Review the export record",
  model: "claude-sonnet-5-5",
  effort: "medium",
  planMarkdownAnchor: "#phase-03",
  plannedFilesToCreate: [],
  plannedFilesToEdit: [],
  optionalFilesToEdit: [],
  mode: "interactive",
  oracle: null,
  commit: { subject: "feat(export): review the export record", body: "Made-up body." },
};

const GATE_STEPS: readonly GateStep[] = [
  { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
  { command: "pnpm test", surface: "local", firing: "every-phase", output: "log" },
  { command: "pnpm e2e", surface: "product", firing: "terminal", output: "log" },
];

const CORRECTED_HEADER = "export const header = 'Invoice number';\n";

const ANSWER: InteractiveHandoff = {
  corrections: [
    {
      what: "The invoice header reads `Invoice number`",
      guard: { kind: "test", ref: "tests/invoiceRow.test.ts" },
    },
  ],
  patternFromNowOn: ["Column headers are human-readable"],
  nextPhasesNeedToKnow: ["phase-04 copies the header wording"],
};

const answerText = (answer: InteractiveHandoff = ANSWER): string =>
  JSON.stringify({ $schema: currentSchemaUrl("interactive-handoff"), ...answer });

const PERSON_HANDOFF = [
  "## What was corrected",
  "- The invoice header reads `Invoice number`.",
  "",
  "## The pattern to follow from now on",
  "- Column headers are human-readable.",
  "",
  "## Guards",
  "- no guard: a one-word label, checked by eye.",
  "",
  "## What the next phases need to know",
  "- phase-04 copies the header wording.",
  "",
].join("\n");

let world: World;

beforeEach(async () => {
  world = createWorld();
  const { loadConfig } = await import("../../src/app/loadConfig.js");
  vi.mocked(loadConfig).mockReturnValue(Either.right(resolvedConfig(world)));
});

afterEach(() => {
  vi.clearAllMocks();
  world.cleanup();
});

// ── Helpers ────────────────────────────────────────────────────────────────

const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

const write = (run: StoppedRun, path: string, content: string): void => {
  mkdirSync(dirname(join(run.worktree, path)), { recursive: true });
  writeFileSync(join(run.worktree, path), content);
};

const read = (run: StoppedRun, path: string): string =>
  readFileSync(join(run.worktree, path), "utf8");

const correct = (run: StoppedRun): void => write(run, "src/invoiceRow.ts", CORRECTED_HEADER);

const writePersonHandoff = (run: StoppedRun, text = PERSON_HANDOFF): void =>
  write(run, PERSON_HANDOFF_PATH, text);

interface ScriptedStep {
  readonly exitCode: number;
  readonly onRun?: () => void;
}

const PASSING: Readonly<Record<string, ScriptedStep>> = {
  "pnpm typecheck": { exitCode: 0 },
  "pnpm test": { exitCode: 0 },
};

const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));
const realGit = Effect.runSync(Effect.provide(Git, NodeGitLayer));

// The scripted `pnpm` steps record themselves in `order`; any other command
// (git, for the close's commit message read) runs for real.
function scriptedShell(script: Readonly<Record<string, ScriptedStep>>, order: string[]) {
  return Layer.succeed(Shell, {
    run: (options) => {
      const line = options.command.join(" ");
      const step = script[line];
      if (step === undefined) return realShell.run(options);
      return Effect.sync(() => {
        order.push(`gate:${line}`);
        step.onRun?.();
        return {
          exitCode: step.exitCode,
          stdout: "",
          stderr: step.exitCode === 0 ? "" : "1 failed: invoiceRow header",
          stdoutEncoding: "utf8" as const,
        };
      });
    },
  });
}

const ctxOf = (run: StoppedRun) => ({
  runPath: run.runPath,
  shortName: run.shortName,
  phaseFolderPath: run.phaseFolder,
  phaseId: "phase-03",
});

const resumeRequested = (run: StoppedRun) =>
  dispatch(
    {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      run: run.shortName as unknown as RunId,
      phase: "phase-03" as PhaseId,
      type: "RunResumeRequested",
    },
    ctxOf(run),
  );

const closeInput = (run: StoppedRun) => ({
  runId: run.runId as RunId,
  shortName: run.shortName,
  runPath: run.runPath,
  phase: PHASE_03,
  phaseFolder: run.phaseFolder,
  worktree: run.worktree,
  gateSteps: GATE_STEPS,
  gateRequest: Effect.succeed("{}"),
  fileReconciliationMode: "report_only" as const,
});

interface CloseOptions {
  readonly backend?: FakeBackendImpl;
  readonly shell?: Readonly<Record<string, ScriptedStep>>;
  readonly git?: GitOps;
  /** Dispatch `RunResumeRequested` first (default true); false re-enters a close in progress. */
  readonly resume?: boolean;
  /** Played by the provider when a closing turn resumes: a turn that writes, say. */
  readonly onResume?: () => void;
}

function layers(options: CloseOptions, order: string[], backend: FakeBackendImpl) {
  return Layer.mergeAll(
    Layer.succeed(Backend, backend),
    NodeFileSystemLayer,
    Layer.succeed(Git, options.git ?? realGit),
    scriptedShell(options.shell ?? PASSING, order),
    NoopSystemTelemetryLayer,
  );
}

async function close(run: StoppedRun, options: CloseOptions = {}) {
  const order: string[] = [];
  const backend = options.backend ?? makeFakeBackend().impl;
  backend.setOnRunAgent(() => order.push("turn:new"));
  backend.setOnResumeAgent((id) => {
    order.push(`turn:resume:${id}`);
    options.onResume?.();
  });
  const program = Effect.gen(function* () {
    if (options.resume !== false) yield* resumeRequested(run);
    return yield* Effect.either(closeDeclaredStop(closeInput(run)));
  });
  const result = await Effect.runPromise(
    program.pipe(Effect.provide(layers(options, order, backend))),
  );
  return { result, order, backend };
}

const report = (result: Either.Either<CloseReport, unknown>): CloseReport => {
  if (Either.isLeft(result)) throw new Error(`close refused: ${String(result.left)}`);
  return result.right;
};

const refusal = (result: Either.Either<CloseReport, unknown>): StopCloseRefusedError => {
  if (Either.isRight(result)) throw new Error("the close was not refused");
  expect(result.left).toBeInstanceOf(StopCloseRefusedError);
  return result.left as StopCloseRefusedError;
};

// The refusal's lastClose, narrowed to the variant `result` names.
function lastCloseOf<R extends RefusedClose["result"]>(
  error: StopCloseRefusedError,
  result: R,
): Extract<RefusedClose, { readonly result: R }> {
  expect(error.lastClose.result).toBe(result);
  return error.lastClose as Extract<RefusedClose, { readonly result: R }>;
}

const answering = (finalText = answerText(), sessionId = SESSION_X1): FakeBackendImpl => {
  const backend = makeFakeBackend().impl;
  backend.addResumeResponse({ sessionId, outputPath: "", finalText });
  return backend;
};

const head = (run: StoppedRun): string => gitIn(run.worktree, "rev-parse", "HEAD").trim();
const runState = (run: StoppedRun) => readJson(join(run.runPath, "run-status.json"))["state"];
const phaseStatus = (run: StoppedRun) => readJson(join(run.phaseFolder, "status.json"));
const reviewStopPath = (run: StoppedRun) => join(run.runPath, "review-stop.json");
const parkedPath = (run: StoppedRun) => join(run.phaseFolder, "review-stop.closing.json");
const reconciliation = (run: StoppedRun) =>
  readJson(join(run.phaseFolder, "file-reconciliation.json"));

// A refused close returns the run to its stop, with lastClose recorded.
function expectBackAtStop(run: StoppedRun, result: string): Record<string, unknown> {
  expect(runState(run)).toBe("awaiting_review");
  expect(phaseStatus(run)["state"]).toBe("awaiting_review");
  expect(existsSync(parkedPath(run))).toBe(false);
  const stop = readJson(reviewStopPath(run));
  const lastClose = stop["lastClose"] as Record<string, unknown>;
  expect(lastClose["result"]).toBe(result);
  return lastClose;
}

// ── Closing ────────────────────────────────────────────────────────────────

describe("closing a declared stop", () => {
  it("gates first, resumes X1 read-only with the content diff and commits the gated tree", async () => {
    const run = await stopRun(world);
    const base = head(run);
    correct(run);

    const { result, order, backend } = await close(run, { backend: answering() });
    const closed = report(result);

    // The gate runs before any turn, on its non-terminal steps only.
    expect(order).toEqual(["gate:pnpm typecheck", "gate:pnpm test", "turn:resume:X1"]);
    expect(backend.runCalls).toEqual([]);
    const [resume, ...more] = backend.resumeCalls;
    expect(more).toEqual([]);
    expect(resume!.sessionId).toBe("X1");
    expect(resume!.options).toMatchObject({
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      effort: "medium",
      readOnly: true,
      agentCommands: [],
      cwd: run.worktree,
      outputJsonlPath: join(run.phaseFolder, "closing-turn-01.jsonl"),
    });
    expect(resume!.prompt).toContain("-export const header = 'invoice_no';");
    expect(resume!.prompt).toContain("+export const header = 'Invoice number';");
    expect(resume!.prompt).not.toContain("interactive-review.md");
    expect(resume!.prompt).toMatch(
      /`\$schema` first, set to `https:\/\/docs\.phax\.run\/schemas\/interactive-handoff\/\d+\.\d+\.\d+\.json`/,
    );

    expect(closed).toMatchObject({
      outcome: "corrected",
      handoffSource: "closing-turn-resumed",
      changedPaths: ["src/invoiceRow.ts"],
      restoredClosingTurn: null,
    });
    expect(closed.gateSteps.map((s) => [s.command, s.result])).toEqual([
      ["pnpm typecheck", "pass"],
      ["pnpm test", "pass"],
    ]);
    expect(readFileSync(join(run.phaseFolder, "phase-handoff.md"), "utf8")).toBe(
      renderInteractiveHandoff(ANSWER),
    );

    // The commit: the plan's subject and body, the interactive trailers, Ada
    // Example as author, exactly the corrected file.
    expect(closed.commit).toBe(head(run));
    expect(gitIn(run.worktree, "rev-parse", "HEAD^").trim()).toBe(base);
    expect(gitIn(run.worktree, "log", "-1", "--format=%an <%ae>").trim()).toBe(
      "Ada Example <ada@example.test>",
    );
    expect(gitIn(run.worktree, "log", "-1", "--format=%s").trim()).toBe(PHASE_03.commit.subject);
    const body = gitIn(run.worktree, "log", "-1", "--format=%b");
    expect(body.trim()).toBe(
      buildInteractiveCommitBody({
        phase: PHASE_03,
        runId: run.runId,
        shortName: run.shortName,
        worktreePath: run.worktree,
        gateLogPath: closed.gateLog!,
      }),
    );
    expect(body).toContain("Interactive-Phase: phase-03");
    expect(body).not.toMatch(/^(Session-Id|Model|Effort):/m);
    expect(closed.gateLog).toBe(join(run.phaseFolder, "checks-attempt-01.log"));
    expect(
      gitIn(run.worktree, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim(),
    ).toBe("src/invoiceRow.ts");
    expect(gitIn(run.worktree, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(run.phaseFolder, "diff.patch"), "utf8")).toContain(
      "+export const header = 'Invoice number';",
    );

    // The state: committed with its outcome, review-stop.json gone everywhere.
    expect(runState(run)).toBe("running");
    expect(phaseStatus(run)).toMatchObject({
      state: "committed",
      commitHash: closed.commit,
      stop: { cause: "declared", status: "closed", outcome: "corrected", oracleStep: "none" },
    });
    expect(existsSync(reviewStopPath(run))).toBe(false);
    expect(existsSync(parkedPath(run))).toBe(false);

    // Every changed file is a review correction, none a deviation.
    expect(reconciliation(run)).toMatchObject({
      reviewCorrections: ["src/invoiceRow.ts"],
      unplannedCreated: [],
      unplannedEdited: [],
      hasDeviations: false,
    });
    const session = await Effect.runPromise(
      readInteractiveSession(run.phaseFolder).pipe(Effect.provide(NodeFileSystemLayer)),
    );
    expect(session?.turnInProgress).toBeNull();
  });

  it("uses the person's handoff file byte for byte, with no turn", async () => {
    const run = await stopRun(world);
    correct(run);
    const text = `${PERSON_HANDOFF}\n<!-- kept as written -->\n`;
    writePersonHandoff(run, text);

    const { result, backend } = await close(run);
    const closed = report(result);

    expect(closed.handoffSource).toBe("person");
    expect(backend.runCalls).toEqual([]);
    expect(backend.resumeCalls).toEqual([]);
    expect(readFileSync(join(run.phaseFolder, "phase-handoff.md"), "utf8")).toBe(text);
    // The handoff file sits in .phax-context/, which the commit never holds.
    const files = gitIn(run.worktree, "show", "--name-only", "--format=", "HEAD").trim();
    expect(files).toBe("src/invoiceRow.ts");
  });

  it("lands an empty commit for an unchanged stop, with outcome unchanged", async () => {
    const run = await stopRun(world);
    const base = head(run);

    const { result, backend } = await close(run);
    const closed = report(result);

    expect(closed).toMatchObject({
      outcome: "unchanged",
      handoffSource: "unchanged",
      changedPaths: [],
    });
    expect(backend.resumeCalls).toEqual([]);
    expect(gitIn(run.worktree, "rev-parse", "HEAD^").trim()).toBe(base);
    expect(gitIn(run.worktree, "rev-parse", "HEAD^{tree}").trim()).toBe(
      gitIn(run.worktree, "rev-parse", `${base}^{tree}`).trim(),
    );
    expect(gitIn(run.worktree, "log", "-1", "--format=%b")).toContain(
      "Interactive-Phase: phase-03",
    );
    expect(readFileSync(join(run.phaseFolder, "phase-handoff.md"), "utf8")).toBe(
      REVIEWED_WITHOUT_CHANGE_HANDOFF,
    );
    expect(phaseStatus(run)).toMatchObject({
      state: "committed",
      stop: { cause: "declared", status: "closed", outcome: "unchanged" },
    });
    expect(reconciliation(run)).toMatchObject({ reviewCorrections: [], hasDeviations: false });
  });

  it("starts a new read-only session with the seed and the diff when no session is current", async () => {
    const run = await stopRun(world, { sessionId: undefined });
    correct(run);
    const backend = makeFakeBackend().impl;
    backend.addRunResponse({
      sessionId: "X5" as ClaudeSessionId,
      outputPath: "",
      finalText: answerText(),
    });

    const { result } = await close(run, { backend });
    const closed = report(result);

    expect(closed.handoffSource).toBe("closing-turn-new");
    expect(backend.resumeCalls).toEqual([]);
    const [started] = backend.runCalls;
    expect(started!.prompt).toContain(".phax-context/interactive-review.md");
    expect(started!.prompt).toContain("+export const header = 'Invoice number';");
    expect(started!.options).toMatchObject({
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      effort: "medium",
      readOnly: true,
      outputJsonlPath: join(run.phaseFolder, "closing-turn-01.jsonl"),
    });
  });

  it("falls back to a new session when the resume reports the session not found", async () => {
    const run = await stopRun(world);
    correct(run);
    // The turn interactive-session.json records in progress while the new session runs.
    const recorded: unknown[] = [];
    class Observing extends FakeBackendImpl {
      override runAgent(prompt: string, options: AgentRunOptions) {
        recorded.push(
          readJson(join(run.phaseFolder, "interactive-session.json"))["turnInProgress"],
        );
        return super.runAgent(prompt, options);
      }
    }
    const backend = new Observing();
    backend.failNextResume("No conversation found with session ID: X1");
    backend.addRunResponse({
      sessionId: "X6" as ClaudeSessionId,
      outputPath: "",
      finalText: answerText(),
    });

    const { result, order } = await close(run, { backend });
    const closed = report(result);

    expect(closed.handoffSource).toBe("closing-turn-new");
    expect(order.slice(-2)).toEqual(["turn:resume:X1", "turn:new"]);
    expect(backend.runCalls[0]!.prompt).toContain(".phax-context/interactive-review.md");
    // The new session is the next closing turn, so the ledger reads both streams.
    expect(backend.runCalls[0]!.options.outputJsonlPath).toBe(
      join(run.phaseFolder, "closing-turn-02.jsonl"),
    );
    expect(recorded).toEqual([
      expect.objectContaining({ kind: "closing-turn", turn: 2, origin: "new-session" }),
    ]);
  });

  it("closes a vibe stop with a headless resume of V1 on mistral-vibe", async () => {
    const run = await stopRun(world, {
      provider: "mistral-vibe",
      model: "devstral-2",
      sessionId: "V1",
    });
    correct(run);

    const { result, backend } = await close(run, {
      backend: answering(answerText(), "V1" as ClaudeSessionId),
    });

    expect(report(result).handoffSource).toBe("closing-turn-resumed");
    expect(backend.resumeCalls[0]!.sessionId).toBe("V1");
    expect(backend.resumeCalls[0]!.options).toMatchObject({
      provider: "mistral-vibe",
      model: "devstral-2",
      effort: "medium",
    });
  });
});

// ── Refusals: every one returns the run to the stop ────────────────────────

describe("a refused close", () => {
  it("returns a red gate to the person: exit 4, its log kept, nothing committed", async () => {
    const run = await stopRun(world);
    const base = head(run);
    correct(run);

    const { result, backend } = await close(run, {
      shell: { ...PASSING, "pnpm test": { exitCode: 1 } },
    });
    const error = refusal(result);

    expect(exitCodeForError(error)).toBe(4);
    expect(error.lastClose).toMatchObject({ result: "gate-failed", exitCode: 4 });
    const { log } = lastCloseOf(error, "gate-failed");
    expect(readFileSync(log, "utf8")).toContain("1 failed: invoiceRow header");
    expect(head(run)).toBe(base);
    expect(backend.resumeCalls).toEqual([]);
    expect(expectBackAtStop(run, "gate-failed")).toMatchObject({ exitCode: 4, log });
    expect(read(run, "src/invoiceRow.ts")).toBe(CORRECTED_HEADER);
  });

  it("refuses a gate request it cannot build as close-error (gate), back at the stop", async () => {
    const run = await stopRun(world);
    correct(run);
    const order: string[] = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* resumeRequested(run);
        return yield* Effect.either(
          closeDeclaredStop({
            ...closeInput(run),
            gateRequest: Effect.fail(new FsError({ message: "status.json: not valid JSON" })),
          }),
        );
      }).pipe(Effect.provide(layers({}, order, makeFakeBackend().impl))),
    );
    const error = refusal(result);

    expect(order).toEqual([]);
    expect(error.lastClose).toMatchObject({
      result: "close-error",
      exitCode: 1,
      step: "gate",
      detail: "status.json: not valid JSON",
    });
    expect(read(run, "src/invoiceRow.ts")).toBe(CORRECTED_HEADER);
    expectBackAtStop(run, "close-error");
  });

  it("refuses a person's handoff file missing a section: exit 1, naming it", async () => {
    const run = await stopRun(world);
    correct(run);
    writePersonHandoff(run, PERSON_HANDOFF.replace(/## Guards\n- no guard: [^\n]*\n\n/, ""));

    const error = refusal((await close(run)).result);

    expect(exitCodeForError(error)).toBe(1);
    expect(error.lastClose).toMatchObject({ result: "handoff-invalid", exitCode: 1 });
    const { defects } = lastCloseOf(error, "handoff-invalid");
    expect(defects).toContain('missing section "## Guards"');
    expectBackAtStop(run, "handoff-invalid");
  });

  it("refuses a person's handoff file with an uncovered correction", async () => {
    const run = await stopRun(world);
    correct(run);
    writePersonHandoff(
      run,
      PERSON_HANDOFF.replace(
        "- The invoice header reads `Invoice number`.",
        "- The invoice header reads `Invoice number`.\n- The credit column is signed.",
      ),
    );

    const error = refusal((await close(run)).result);

    expect(lastCloseOf(error, "handoff-invalid").defects).toContain(
      '"## Guards" holds 1 entries for 2 corrections: one guard per correction, in order',
    );
  });

  it("refuses a closing answer invalid twice after exactly one corrective resume: exit 5", async () => {
    const run = await stopRun(world);
    correct(run);
    const backend = makeFakeBackend().impl;
    backend.addResumeResponse({ sessionId: SESSION_X1, outputPath: "", finalText: "Looks good!" });
    backend.addResumeResponse({ sessionId: SESSION_X1, outputPath: "", finalText: "{}" });

    const error = refusal((await close(run, { backend })).result);

    expect(exitCodeForError(error)).toBe(5);
    expect(error.lastClose.result).toBe("closing-answer-invalid");
    expect(backend.resumeCalls.map((c) => c.options.outputJsonlPath)).toEqual([
      join(run.phaseFolder, "closing-turn-01.jsonl"),
      join(run.phaseFolder, "closing-turn-01-retry.jsonl"),
    ]);
    expect(backend.runCalls).toEqual([]);
    expectBackAtStop(run, "closing-answer-invalid");
  });

  it("refuses a closing turn that writes in the worktree, moving its edits aside: exit 5", async () => {
    const run = await stopRun(world);
    correct(run);
    const onResume = () => {
      write(run, "src/export/labels.ts", "export const labels = {};\n");
      write(run, "src/invoiceRow.ts", "export const header = 'Turn header';\n");
    };

    const error = refusal((await close(run, { backend: answering(), onResume })).result);

    expect(exitCodeForError(error)).toBe(5);
    expect(error.lastClose).toMatchObject({
      result: "closing-turn-edited",
      exitCode: 5,
      paths: ["src/export/labels.ts", "src/invoiceRow.ts"],
    });
    // The worktree is the gated tree again: the person's correction, no more.
    expect(existsSync(join(run.worktree, "src/export/labels.ts"))).toBe(false);
    expect(read(run, "src/invoiceRow.ts")).toBe(CORRECTED_HEADER);
    const keptAt = join(run.phaseFolder, "refused-turn-01");
    expect(readFileSync(join(keptAt, "src/export/labels.ts"), "utf8")).toBe(
      "export const labels = {};\n",
    );
    expect(readFileSync(join(keptAt, "src/invoiceRow.ts"), "utf8")).toBe(
      "export const header = 'Turn header';\n",
    );
    expectBackAtStop(run, "closing-turn-edited");

    // The next close commits the person's correction only.
    const next = report((await close(run, { backend: answering() })).result);
    expect(next.changedPaths).toEqual(["src/invoiceRow.ts"]);
    expect(gitIn(run.worktree, "show", "HEAD:src/invoiceRow.ts")).toBe(CORRECTED_HEADER);
  });

  it("moves aside a person's handoff file a closing turn wrote, naming it", async () => {
    const run = await stopRun(world);
    correct(run);
    const onResume = () => writePersonHandoff(run);

    const error = refusal((await close(run, { backend: answering(), onResume })).result);

    expect(error.lastClose).toMatchObject({
      result: "closing-turn-edited",
      paths: [PERSON_HANDOFF_PATH],
    });
    expect(existsSync(join(run.worktree, PERSON_HANDOFF_PATH))).toBe(false);
    expect(
      readFileSync(join(run.phaseFolder, "refused-turn-01", PERSON_HANDOFF_PATH), "utf8"),
    ).toBe(PERSON_HANDOFF);
    expectBackAtStop(run, "closing-turn-edited");
  });

  it("refuses an edit made after the gate as worktree-changed: exit 1", async () => {
    const run = await stopRun(world);
    correct(run);
    writePersonHandoff(run);
    let edited = false;
    // The first read of HEAD's tree comes right after the gated snapshot.
    const git: GitOps = {
      ...realGit,
      headTree: (path) => {
        if (!edited) {
          edited = true;
          write(run, "src/invoiceRow.ts", "export const header = 'Invoice no.';\n");
        }
        return realGit.headTree(path);
      },
    };

    const error = refusal((await close(run, { git })).result);

    expect(exitCodeForError(error)).toBe(1);
    expect(error.lastClose).toMatchObject({
      result: "worktree-changed",
      exitCode: 1,
      paths: ["src/invoiceRow.ts"],
    });
    expectBackAtStop(run, "worktree-changed");
  });

  it("refuses a usage limit with its reset time: exit 8", async () => {
    const run = await stopRun(world);
    correct(run);
    const backend = makeFakeBackend().impl;
    backend.failNextResumeWithRateLimit({ kind: "usage_limit", resetAt: "2026-10-22T18:00:00Z" });

    const error = refusal((await close(run, { backend })).result);

    expect(exitCodeForError(error)).toBe(8);
    expect(error.lastClose).toMatchObject({
      result: "limit",
      exitCode: 8,
      resetAt: "2026-10-22T18:00:00Z",
    });
    expect(backend.runCalls).toEqual([]);
    expectBackAtStop(run, "limit");
  });

  it("refuses a commit a pre-commit hook rejects as close-error (commit): exit 1, worktree untouched", async () => {
    const run = await stopRun(world);
    const base = head(run);
    correct(run);
    writePersonHandoff(run);
    const hooks = join(world.root, "hooks");
    mkdirSync(hooks);
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n", {
      mode: 0o755,
    });
    gitIn(world.repoRoot, "config", "--local", "core.hooksPath", hooks);
    const statusBefore = gitIn(run.worktree, "status", "--porcelain");

    const error = refusal((await close(run)).result);

    expect(exitCodeForError(error)).toBe(1);
    expect(error.lastClose).toMatchObject({ result: "close-error", exitCode: 1, step: "commit" });
    expect(lastCloseOf(error, "close-error").detail).toContain("lint failed");
    expect(head(run)).toBe(base);
    expect(gitIn(run.worktree, "status", "--porcelain")).toBe(statusBefore);
    expect(read(run, "src/invoiceRow.ts")).toBe(CORRECTED_HEADER);
    expect(read(run, PERSON_HANDOFF_PATH)).toBe(PERSON_HANDOFF);
    // No RunFailed: the run is back at its stop, not failed.
    expectBackAtStop(run, "close-error");
  });

  it("refuses a provider error in a new closing session as close-error (closing-turn): exit 5", async () => {
    const run = await stopRun(world, { sessionId: undefined });
    correct(run);

    const error = refusal((await close(run)).result);

    expect(exitCodeForError(error)).toBe(5);
    expect(error.lastClose).toMatchObject({
      result: "close-error",
      exitCode: 5,
      step: "closing-turn",
    });
    expectBackAtStop(run, "close-error");
  });
});

// ── A close interrupted ────────────────────────────────────────────────────

describe("a close taken up again", () => {
  it("finishes a close whose commit landed before an interruption, with no new commit", async () => {
    const run = await stopRun(world);
    const base = head(run);
    correct(run);
    const landed = await Effect.runPromise(
      Effect.gen(function* () {
        yield* resumeRequested(run);
        // The close recorded its base, wrote the handoff and committed, then stopped.
        const parked = readJson(parkedPath(run));
        writeFileSync(parkedPath(run), JSON.stringify({ ...parked, closeBase: base }, null, 2));
        writeFileSync(join(run.phaseFolder, "phase-handoff.md"), PERSON_HANDOFF);
        const tree = yield* realGit.snapshotWorktree(run.worktree);
        return yield* realGit.commitTree(
          run.worktree,
          tree,
          PHASE_03.commit.subject,
          buildInteractiveCommitBody({
            phase: PHASE_03,
            runId: run.runId,
            shortName: run.shortName,
            worktreePath: run.worktree,
            gateLogPath: join(run.phaseFolder, "checks-attempt-01.log"),
          }),
        );
      }).pipe(Effect.provide(layers({}, [], makeFakeBackend().impl))),
    );

    const { result, order } = await close(run, { resume: false });
    const closed = report(result);

    expect(order).toEqual([]);
    expect(head(run)).toBe(landed);
    expect(closed).toMatchObject({
      outcome: "corrected",
      commit: landed,
      handoffSource: "earlier-close",
      gateLog: join(run.phaseFolder, "checks-attempt-01.log"),
      changedPaths: ["src/invoiceRow.ts"],
    });
    expect(phaseStatus(run)).toMatchObject({
      state: "committed",
      commitHash: landed,
      stop: { cause: "declared", status: "closed", outcome: "corrected", oracleStep: "none" },
    });
    expect(reconciliation(run)).toMatchObject({ reviewCorrections: ["src/invoiceRow.ts"] });
    expect(existsSync(parkedPath(run))).toBe(false);
  });

  it("refuses to finish a landed close while the worktree changed since its commit", async () => {
    const run = await stopRun(world);
    const base = head(run);
    correct(run);
    const landed = await Effect.runPromise(
      Effect.gen(function* () {
        yield* resumeRequested(run);
        const parked = readJson(parkedPath(run));
        writeFileSync(parkedPath(run), JSON.stringify({ ...parked, closeBase: base }, null, 2));
        const tree = yield* realGit.snapshotWorktree(run.worktree);
        return yield* realGit.commitTree(
          run.worktree,
          tree,
          PHASE_03.commit.subject,
          buildInteractiveCommitBody({
            phase: PHASE_03,
            runId: run.runId,
            shortName: run.shortName,
            worktreePath: run.worktree,
            gateLogPath: join(run.phaseFolder, "checks-attempt-01.log"),
          }),
        );
      }).pipe(Effect.provide(layers({}, [], makeFakeBackend().impl))),
    );
    // An edit made after the commit landed, before the next close.
    write(run, "src/invoiceRow.ts", "export const header = 'Invoice no.';\n");

    const error = refusal((await close(run, { resume: false })).result);

    expect(error.lastClose).toMatchObject({
      result: "worktree-changed",
      exitCode: 1,
      paths: ["src/invoiceRow.ts"],
    });
    expect(head(run)).toBe(landed);
    expect(read(run, "src/invoiceRow.ts")).toBe("export const header = 'Invoice no.';\n");
    expectBackAtStop(run, "worktree-changed");
  });

  it("refuses a HEAD that moved to a commit that is not the stop's", async () => {
    const run = await stopRun(world);
    const base = head(run);
    await Effect.runPromise(
      resumeRequested(run).pipe(Effect.provide(layers({}, [], makeFakeBackend().impl))),
    );
    const parked = readJson(parkedPath(run));
    writeFileSync(parkedPath(run), JSON.stringify({ ...parked, closeBase: base }, null, 2));
    correct(run);
    gitIn(run.worktree, "commit", "-am", "wip: by hand");
    const moved = head(run);

    const error = refusal((await close(run, { resume: false })).result);

    expect(error.lastClose).toMatchObject({ result: "close-error", exitCode: 1, step: "commit" });
    const detail = (error.lastClose as Extract<RefusedClose, { result: "close-error" }>).detail;
    expect(detail).toContain(`HEAD moved from ${base} to ${moved}`);
    expect(detail).toContain(`git -C '${run.worktree}' reset --soft ${base}`);
    // phax rewrites no history: the person's commit stays.
    expect(head(run)).toBe(moved);
    expectBackAtStop(run, "close-error");
  });

  it("refuses a commit the person made before the first close, naming the soft reset", async () => {
    const run = await stopRun(world);
    const base = head(run);
    correct(run);
    gitIn(run.worktree, "commit", "-am", "wip: by hand");
    const moved = head(run);

    const { result, order } = await close(run);
    const error = refusal(result);

    expect(order).toEqual([]);
    expect(error.lastClose).toMatchObject({ result: "close-error", exitCode: 1, step: "commit" });
    const detail = (error.lastClose as Extract<RefusedClose, { result: "close-error" }>).detail;
    expect(detail).toContain(`HEAD moved from the phase's base ${base} to ${moved}`);
    expect(detail).toContain(`git -C '${run.worktree}' reset --soft ${base}`);
    expect(head(run)).toBe(moved);
    const lastClose = expectBackAtStop(run, "close-error");
    expect(lastClose["step"]).toBe("commit");
    expect(readJson(reviewStopPath(run))["closeBase"]).toBeNull();

    // Following the remedy, the next close takes the correction as the person's.
    gitIn(run.worktree, "reset", "--soft", base);
    writePersonHandoff(run);
    const closed = report((await close(run)).result);
    expect(closed).toMatchObject({ outcome: "corrected", changedPaths: ["src/invoiceRow.ts"] });
  });

  it("restores an interrupted vibe closing turn's edits before the gate", async () => {
    const run = await stopRun(world, {
      provider: "mistral-vibe",
      model: "devstral-2",
      sessionId: "V1",
    });
    correct(run);

    // The vibe closing turn writes a file, then never ends: the close is interrupted.
    const started = Effect.runSync(Deferred.make<void>());
    class HangingBackend extends FakeBackendImpl {
      override resumeAgentSession(
        _sessionId: ClaudeSessionId,
        _prompt: string,
        _options: AgentRunOptions,
      ): Effect.Effect<AgentRunResult, never> {
        write(run, "src/export/labels.ts", "export const labels = {};\n");
        return Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never));
      }
    }
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* resumeRequested(run);
        const fiber = yield* Effect.fork(closeDeclaredStop(closeInput(run)));
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
      }).pipe(Effect.provide(layers({}, [], new HangingBackend()))),
    );
    const interrupted = await Effect.runPromise(
      readInteractiveSession(run.phaseFolder).pipe(Effect.provide(NodeFileSystemLayer)),
    );
    expect(interrupted?.turnInProgress).toMatchObject({ kind: "closing-turn", turn: 1 });
    expect(read(run, "src/export/labels.ts")).toBe("export const labels = {};\n");

    // `phax resume` takes the close up again: the turn's edit is restored
    // before the gate, so neither the gate nor the new closing turn sees it.
    const backend = answering(answerText(), "V1" as ClaudeSessionId);
    const { result, order } = await close(run, { resume: false, backend });
    const closed = report(result);

    expect(closed.restoredClosingTurn).toEqual({
      paths: ["src/export/labels.ts"],
      keptAt: join(run.phaseFolder, "refused-turn-01"),
    });
    expect(order).toEqual(["gate:pnpm typecheck", "gate:pnpm test", "turn:resume:V1"]);
    expect(backend.resumeCalls[0]!.prompt).not.toContain("labels");
    expect(existsSync(join(run.worktree, "src/export/labels.ts"))).toBe(false);
    expect(
      readFileSync(join(run.phaseFolder, "refused-turn-01", "src/export/labels.ts"), "utf8"),
    ).toBe("export const labels = {};\n");
    expect(closed.changedPaths).toEqual(["src/invoiceRow.ts"]);
    expect(gitIn(run.worktree, "show", "--name-only", "--format=", "HEAD").trim()).toBe(
      "src/invoiceRow.ts",
    );
    const settled = await Effect.runPromise(
      readInteractiveSession(run.phaseFolder).pipe(Effect.provide(NodeFileSystemLayer)),
    );
    expect(settled?.turnInProgress).toBeNull();
  });
});

// ── §5.44: a correction is the same whoever made it ──────────────────────

describe("two identical stops, corrected directly and through enter-phase", () => {
  it("give commits with the same tree and equal reconciliations", async () => {
    const direct = await stopRun(world);
    const entered = await stopRun(world, { shortName: "credit-notes" });

    correct(direct);
    // The session `phax enter-phase` spawns writes the same bytes.
    sessionLayer.current = Layer.succeed(Session, {
      resume: (invocation) =>
        Effect.sync(() => {
          mkdirSync(join(invocation.cwd, "src"), { recursive: true });
          writeFileSync(join(invocation.cwd, "src", "invoiceRow.ts"), CORRECTED_HEADER);
          return 0;
        }),
    });
    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
    expect(await runEnterPhase(entered.shortName, "phase-03", quiet, {})).toBe(0);
    expect(read(entered, "src/invoiceRow.ts")).toBe(CORRECTED_HEADER);

    for (const run of [direct, entered]) writePersonHandoff(run);
    const a = report((await close(direct)).result);
    const b = report((await close(entered)).result);

    expect(a.outcome).toBe("corrected");
    expect(b.outcome).toBe("corrected");
    expect(gitIn(direct.worktree, "rev-parse", "HEAD^{tree}")).toBe(
      gitIn(entered.worktree, "rev-parse", "HEAD^{tree}"),
    );
    expect(reconciliation(direct)).toEqual(reconciliation(entered));
    expect(reconciliation(direct)["reviewCorrections"]).toEqual(["src/invoiceRow.ts"]);
  });
});
