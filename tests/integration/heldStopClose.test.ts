import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHeldReviewCommitBody } from "../../src/app/commit.js";
import { closeStop, type CloseReport } from "../../src/app/closeStop.js";
import { nextLedger } from "../../src/app/costLedger.js";
import { dispatch } from "../../src/app/dispatcher.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { renderStopClosed, renderStopCloseRefused } from "../../src/cli/commands/stopOutput.js";
import type { ClaudeSessionId, PhaseId, RunId } from "../../src/domain/branded.js";
import { StopCloseRefusedError, type RefusedClose } from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import {
  REVIEWED_WITHOUT_CHANGE_HANDOFF,
  renderInteractiveHandoff,
} from "../../src/domain/interactive/handoff.js";
import { PERSON_HANDOFF_PATH } from "../../src/domain/interactive/worktreeChange.js";
import { makeNodeBackendLayer } from "../../src/infra/claudeCli.js";
import { FakeBackendImpl, makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend, type BackendOps } from "../../src/ports/backend.js";
import { Git } from "../../src/ports/git.js";
import { Session } from "../../src/ports/session.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { InteractiveHandoff } from "../../src/schemas/interactiveHandoff.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import { makeFakeProviderCli } from "../helpers/fakeProviderCli.js";
import {
  SHORT,
  createHeldWorld,
  gitIn,
  readJson,
  startHeldRun,
  worktreeOf,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";

// Closing the made-up invoice-export run held at phase-02 (`--hold
// phase-02`): the real run loop builds phase-02 on codex in session X0 and
// stops after its commit C2; the test then corrects the worktree and closes
// the stop through `closeStop`. Real git, the real file system, a fake
// backend (or the fake provider CLIs) playing the closing turn, and a shell
// whose `pnpm` gate steps are scripted while git runs for real.

const sessionLayer = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/infra/session.js", () => ({
  makeNodeSessionLayer: () => sessionLayer.current,
}));
// No test reads ~/.phax: the routing and providers.json are the built-in catalog.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/loadRouting.js")>()),
  loadModelRouting: () => Effect.succeed(DEFAULT_MODEL_ROUTING),
  loadProviderConfig: () => Effect.succeed(DEFAULT_PROVIDER_CONFIG),
}));
// The journal would write under ~/.phax: telemetry is off in these tests.
vi.mock("../../src/cli/commands/runLayers.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/cli/commands/runLayers.js")>();
  const { NoopSystemTelemetryLayer: noop } = await import("../../src/ports/systemTelemetry.js");
  return { ...original, makeGlobalTelemetryJournalLayerOrNoop: () => noop };
});

const HOLD_PHASE_02 = { selection: "listed", phases: ["phase-02"] } as const;

const GATE_STEPS: readonly GateStep[] = [
  { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
  { command: "pnpm test", surface: "local", firing: "every-phase", output: "log" },
  { command: "pnpm e2e", surface: "product", firing: "terminal", output: "log" },
];

const CORRECTED_HEADER = "export const header = 'Invoice number';\n";
const NEW_TEST = "it('reads Invoice number', () => {});\n";

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

const answerText = (): string =>
  JSON.stringify({ $schema: currentSchemaUrl("interactive-handoff"), ...ANSWER });

const PERSON_HANDOFF = [
  "## What was corrected",
  "- The invoice header reads `Invoice number`.",
  "",
  "## The pattern to follow from now on",
  "- Column headers are human-readable.",
  "",
  "## Guards",
  "- test: tests/invoiceRow.test.ts",
  "",
  "## What the next phases need to know",
  "- phase-04 copies the header wording.",
  "",
].join("\n");

// The phase's own files, which a held close never writes.
const PHASE_OWN_FILES = [
  "phase-handoff.md",
  "diff.patch",
  "file-reconciliation.json",
  "file-reconciliation.md",
  "gate-attribution.json",
  "checks-attempt-01.log",
];

let world: HeldWorld;
let run: HeldRun;

beforeEach(async () => {
  world = createHeldWorld();
  vi.stubEnv("HOME", world.home);
  run = await heldAtPhase02(world);
}, 30_000);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  world.cleanup();
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function heldAtPhase02(w: HeldWorld): Promise<HeldRun> {
  const started = await startHeldRun(w, HOLD_PHASE_02);
  expect(readJson(join(started.run.runPath, "run-status.json"))["state"]).toBe("awaiting_review");
  return started.run;
}

const phaseFolder = (r: HeldRun = run): string => join(r.runPath, "phase-02");
const tree = (r: HeldRun = run): string => worktreeOf(r, "phase-02");
const head = (r: HeldRun = run): string => gitIn(tree(r), "rev-parse", "HEAD");
const phase02 = (r: HeldRun = run) => r.plan.phases[1]!;

const write = (path: string, content: string, r: HeldRun = run): void => {
  mkdirSync(dirname(join(tree(r), path)), { recursive: true });
  writeFileSync(join(tree(r), path), content);
};
const read = (path: string): string => readFileSync(join(tree(), path), "utf8");
const inFolder = (name: string): string => readFileSync(join(phaseFolder(), name), "utf8");

const correct = (r: HeldRun = run): void => {
  write("src/invoiceRow.ts", CORRECTED_HEADER, r);
  write("tests/invoiceRow.test.ts", NEW_TEST, r);
};

function ownFiles(): Record<string, string> {
  return Object.fromEntries(PHASE_OWN_FILES.map((name) => [name, inFolder(name)]));
}

function patchSession(patch: Record<string, unknown>): void {
  const path = join(phaseFolder(), "interactive-session.json");
  writeFileSync(path, JSON.stringify({ ...readJson(path), ...patch }, null, 2));
}

const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));
const realGit = Effect.runSync(Effect.provide(Git, NodeGitLayer));

// The scripted `pnpm` steps record themselves in `order`; every other
// command (git) runs for real.
function scriptedShell(failing: ReadonlySet<string>, order: string[]) {
  return Layer.succeed(Shell, {
    run: (options) => {
      const line = options.command.join(" ");
      if (options.command[0] !== "pnpm") return realShell.run(options);
      return Effect.sync(() => {
        order.push(`gate:${line}`);
        const exitCode = failing.has(line) ? 1 : 0;
        return {
          exitCode,
          stdout: "",
          stderr: exitCode === 0 ? "" : "1 failed: invoiceRow header",
          stdoutEncoding: "utf8" as const,
        };
      });
    },
  });
}

const resumeRequested = (r: HeldRun = run) =>
  dispatch(
    {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      run: SHORT as unknown as RunId,
      phase: "phase-02" as PhaseId,
      type: "RunResumeRequested",
    },
    { runPath: r.runPath, shortName: SHORT, phaseFolderPath: phaseFolder(r), phaseId: "phase-02" },
  );

const closeInput = (r: HeldRun = run) => ({
  runId: r.runId,
  shortName: SHORT,
  runPath: r.runPath,
  phase: phase02(r),
  phaseFolder: phaseFolder(r),
  worktree: tree(r),
  gateSteps: GATE_STEPS,
  gateRequest: Effect.succeed("{}"),
  fileReconciliationMode: "report_only" as const,
  phases: r.plan.phases,
  oracles: null,
  mainCheckout: r.world.repoRoot,
});

interface CloseOptions {
  readonly backend?: BackendOps;
  readonly failing?: ReadonlySet<string>;
  /** Dispatch `RunResumeRequested` first (default true); false re-enters a close in progress. */
  readonly resume?: boolean;
  /** Played by the provider when a closing turn resumes: a turn that writes, say. */
  readonly onResume?: () => void;
  readonly run?: HeldRun;
}

async function close(options: CloseOptions = {}) {
  const r = options.run ?? run;
  const order: string[] = [];
  const backend = options.backend ?? makeFakeBackend().impl;
  if (backend instanceof FakeBackendImpl) {
    backend.setOnRunAgent(() => order.push("turn:new"));
    backend.setOnResumeAgent((id) => {
      order.push(`turn:resume:${id}`);
      options.onResume?.();
    });
  }
  const program = Effect.gen(function* () {
    if (options.resume !== false) yield* resumeRequested(r);
    return yield* Effect.either(closeStop(closeInput(r)));
  });
  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Backend, backend),
          NodeFileSystemLayer,
          NodeGitLayer,
          scriptedShell(options.failing ?? new Set(), order),
          NoopSystemTelemetryLayer,
        ),
      ),
    ),
  );
  return { result, order };
}

type HeldReport = Extract<CloseReport, { readonly cause: "held" }>;

const report = (result: Either.Either<CloseReport, unknown>): HeldReport => {
  if (Either.isLeft(result)) throw new Error(`close refused: ${String(result.left)}`);
  if (result.right.cause !== "held") throw new Error("the close was not a held stop's");
  return result.right;
};

const refusal = (result: Either.Either<CloseReport, unknown>): StopCloseRefusedError => {
  if (Either.isRight(result)) throw new Error("the close was not refused");
  expect(result.left).toBeInstanceOf(StopCloseRefusedError);
  return result.left as StopCloseRefusedError;
};

function lastCloseOf<R extends RefusedClose["result"]>(
  error: StopCloseRefusedError,
  result: R,
): Extract<RefusedClose, { readonly result: R }> {
  expect(error.lastClose.result).toBe(result);
  return error.lastClose as Extract<RefusedClose, { readonly result: R }>;
}

const answering = (): FakeBackendImpl => {
  const backend = makeFakeBackend().impl;
  backend.addResumeResponse({
    sessionId: "X0" as ClaudeSessionId,
    outputPath: "",
    finalText: answerText(),
  });
  return backend;
};

const runState = () => readJson(join(run.runPath, "run-status.json"))["state"];
const phaseStatus = () => readJson(join(phaseFolder(), "status.json"));
const reviewStopPath = () => join(run.runPath, "review-stop.json");
const parkedPath = () => join(phaseFolder(), "review-stop.closing.json");
const correctionReconciliation = (r: HeldRun = run) =>
  readJson(join(phaseFolder(r), "correction-reconciliation.json"));

// A refused close returns the run to its held stop, with lastClose recorded.
function expectBackAtStop(result: string): Record<string, unknown> {
  expect(runState()).toBe("awaiting_review");
  expect(phaseStatus()).toMatchObject({ state: "awaiting_review", stop: { cause: "held" } });
  expect(existsSync(parkedPath())).toBe(false);
  const stop = readJson(reviewStopPath());
  expect(stop["cause"]).toBe("held");
  const lastClose = stop["lastClose"] as Record<string, unknown>;
  expect(lastClose["result"]).toBe(result);
  return lastClose;
}

// ── Closing ────────────────────────────────────────────────────────────────

describe("closing a held stop", () => {
  it("gates first, resumes X0 read-only with the diff against C2 and lands one review commit on C2", async () => {
    const c2 = head();
    const before = ownFiles();
    correct();

    const { result, order } = await close({ backend: answering() });
    const closed = report(result);

    // The gate runs before any turn, on its non-terminal steps, under review-gate/.
    expect(order).toEqual(["gate:pnpm typecheck", "gate:pnpm test", "turn:resume:X0"]);
    const gateLog = join(phaseFolder(), "review-gate", "checks-attempt-01.log");
    expect(closed.gateLog).toBe(gateLog);
    expect(existsSync(gateLog)).toBe(true);
    expect(existsSync(join(phaseFolder(), "review-gate", "gate-attribution.json"))).toBe(true);

    // The closing turn: X0 resumed read-only with no agent command, given the corrections.
    expect(closed).toMatchObject({
      cause: "held",
      outcome: "corrected",
      phaseCommit: c2,
      handoffSource: "closing-turn-resumed",
      changedPaths: ["src/invoiceRow.ts", "tests/invoiceRow.test.ts"],
      restoredClosingTurn: null,
      oracleStep: "none",
    });
    expect(closed.gateSteps.map((s) => [s.command, s.result])).toEqual([
      ["pnpm typecheck", "pass"],
      ["pnpm test", "pass"],
    ]);

    // The handoff lands beside the builder's, which stays byte for byte.
    expect(inFolder("correction-handoff.md")).toBe(renderInteractiveHandoff(ANSWER));
    expect(ownFiles()).toEqual(before);

    // The branch: C2 unchanged and exactly one review commit on it.
    if (closed.outcome !== "corrected") throw new Error("not corrected");
    expect(closed.reviewCommit).toBe(head());
    expect(gitIn(tree(), "rev-parse", "HEAD^")).toBe(c2);
    expect(gitIn(tree(), "rev-list", "--count", `${c2}..HEAD`)).toBe("1");
    expect(gitIn(tree(), "log", "-1", "--format=%an <%ae>")).toBe("Ada Example <ada@example.test>");
    expect(gitIn(tree(), "log", "-1", "--format=%s")).toBe(phase02().commit.subject);
    const body = gitIn(tree(), "log", "-1", "--format=%b");
    expect(body).toBe(
      buildHeldReviewCommitBody({
        phase: phase02(),
        runId: run.runId,
        shortName: SHORT,
        worktreePath: tree(),
        gateLogPath: gateLog,
      }),
    );
    expect(body).toContain("Held-Phase: phase-02");
    expect(body).not.toMatch(/^(Phase-Id|Session-Id|Model|Effort):/m);
    expect(gitIn(tree(), "show", "--name-only", "--format=", "HEAD").split("\n")).toEqual([
      "src/invoiceRow.ts",
      "tests/invoiceRow.test.ts",
    ]);
    expect(gitIn(tree(), "status", "--porcelain")).toBe("");

    // The state: committed at C2, the closed stop naming the review commit.
    expect(runState()).toBe("running");
    expect(phaseStatus()).toMatchObject({
      state: "committed",
      commitHash: c2,
      stop: {
        cause: "held",
        status: "closed",
        outcome: "corrected",
        reviewCommit: closed.reviewCommit,
        oracleStep: "none",
      },
    });
    expect(existsSync(reviewStopPath())).toBe(false);
    expect(existsSync(parkedPath())).toBe(false);

    // What `phax resume` prints.
    const lines = renderStopClosed({
      phaseId: "phase-02",
      phaseTitle: phase02().title,
      report: closed,
    });
    expect(lines[0]).toBe(`phase-02 (held): 2 file(s) changed by review, on ${c2.slice(0, 7)}`);
    expect(lines).toContain("  gate  pnpm typecheck   pass");
    expect(lines).toContain(
      "  handoff     closing turn: resumed the current session → correction-handoff.md",
    );
    expect(lines.at(-1)).toBe(
      `✓ phase-02  Invoice CSV record   review commit  ${closed.reviewCommit.slice(0, 7)}  on ${c2.slice(0, 7)}  (corrected)`,
    );
  });

  it("saves review-diff.patch and reconciles the corrections against C2, never as deviations", async () => {
    const before = ownFiles();
    correct();

    report((await close({ backend: answering() })).result);

    expect(inFolder("review-diff.patch")).toContain("+export const header = 'Invoice number';");
    expect(inFolder("review-diff.patch")).not.toContain("src/phase-02.ts");
    expect(ownFiles()).toEqual(before);
    expect(correctionReconciliation()).toMatchObject({
      $schema: expect.stringMatching(
        /^https:\/\/docs\.phax\.run\/schemas\/phase-file-reconciliation\/\d+\.\d+\.\d+\.json$/,
      ),
      phaseId: "phase-02",
      reviewCorrections: ["src/invoiceRow.ts", "tests/invoiceRow.test.ts"],
      unplannedCreated: [],
      unplannedEdited: [],
      hasDeviations: false,
    });
    expect(inFolder("correction-reconciliation.md")).toContain("src/invoiceRow.ts");
  });

  it("closes an unchanged held stop with no commit, no turn and the fixed handoff", async () => {
    const c2 = head();
    const before = ownFiles();
    const backend = makeFakeBackend().impl;

    const { result, order } = await close({ backend });
    const closed = report(result);

    expect(closed).toMatchObject({
      cause: "held",
      outcome: "unchanged",
      phaseCommit: c2,
      handoffSource: "unchanged",
      changedPaths: [],
    });
    expect(order).toEqual(["gate:pnpm typecheck", "gate:pnpm test"]);
    expect(backend.runCalls).toEqual([]);
    expect(backend.resumeCalls).toEqual([]);
    expect(head()).toBe(c2);
    expect(inFolder("correction-handoff.md")).toBe(REVIEWED_WITHOUT_CHANGE_HANDOFF);
    expect(existsSync(join(phaseFolder(), "review-diff.patch"))).toBe(false);
    expect(ownFiles()).toEqual(before);
    expect(correctionReconciliation()).toMatchObject({
      reviewCorrections: [],
      hasDeviations: false,
    });
    expect(phaseStatus()).toMatchObject({
      state: "committed",
      commitHash: c2,
      stop: { cause: "held", status: "closed", outcome: "unchanged" },
    });

    const lines = renderStopClosed({
      phaseId: "phase-02",
      phaseTitle: phase02().title,
      report: closed,
    });
    expect(lines[0]).toBe("phase-02 (held): no change");
    expect(lines).toContain("  handoff     reviewed without change → correction-handoff.md");
    expect(lines.at(-1)).toBe(
      `✓ phase-02  Invoice CSV record   ${c2.slice(0, 7)}  (unchanged, no commit)`,
    );
  });

  it("starts a new read-only session with the seed and the diff when no session is current", async () => {
    patchSession({ current: null });
    correct();
    const backend = makeFakeBackend().impl;
    backend.addRunResponse({
      sessionId: "C2" as ClaudeSessionId,
      outputPath: "",
      finalText: answerText(),
    });

    const closed = report((await close({ backend })).result);

    expect(closed).toMatchObject({ outcome: "corrected", handoffSource: "closing-turn-new" });
    expect(backend.resumeCalls).toEqual([]);
    const [started] = backend.runCalls;
    expect(started!.prompt).toContain(".phax-context/interactive-review.md");
    expect(started!.prompt).toContain("+export const header = 'Invoice number';");
    expect(started!.options).toMatchObject({
      provider: "codex-cli",
      readOnly: true,
      agentCommands: [],
      outputJsonlPath: join(phaseFolder(), "closing-turn-01.jsonl"),
    });
  });

  it("falls back to a new read-only session when codex reports X0 not found", async () => {
    correct();
    const backend = makeFakeBackend().impl;
    backend.failNextResume("thread X0 not found");
    backend.addRunResponse({
      sessionId: "C2" as ClaudeSessionId,
      outputPath: "",
      finalText: answerText(),
    });

    const { result, order } = await close({ backend });
    const closed = report(result);

    expect(closed).toMatchObject({ outcome: "corrected", handoffSource: "closing-turn-new" });
    expect(order.slice(-2)).toEqual(["turn:resume:X0", "turn:new"]);
    expect(backend.runCalls[0]!.prompt).toContain(".phax-context/interactive-review.md");
    expect(backend.runCalls[0]!.prompt).toContain("+export const header = 'Invoice number';");
    expect(backend.runCalls[0]!.options).toMatchObject({
      provider: "codex-cli",
      readOnly: true,
      outputJsonlPath: join(phaseFolder(), "closing-turn-02.jsonl"),
    });
  });

  it("uses the person's handoff file byte for byte, with no turn", async () => {
    const before = inFolder("phase-handoff.md");
    correct();
    const text = `${PERSON_HANDOFF}\n<!-- kept as written -->\n`;
    write(PERSON_HANDOFF_PATH, text);
    const backend = makeFakeBackend().impl;

    const closed = report((await close({ backend })).result);

    expect(closed.handoffSource).toBe("person");
    expect(backend.runCalls).toEqual([]);
    expect(backend.resumeCalls).toEqual([]);
    expect(inFolder("correction-handoff.md")).toBe(text);
    expect(inFolder("phase-handoff.md")).toBe(before);
  });
});

// ── Refusals: every one returns the run to the held stop ──────────────────

describe("a refused held close", () => {
  it("returns a red gate to the person: exit 4, no turn, its log kept, C2 still the tip", async () => {
    const c2 = head();
    correct();
    const backend = makeFakeBackend().impl;

    const { result, order } = await close({ backend, failing: new Set(["pnpm test"]) });
    const error = refusal(result);

    expect(exitCodeForError(error)).toBe(4);
    const { log } = lastCloseOf(error, "gate-failed");
    expect(log).toBe(join(phaseFolder(), "review-gate", "checks-attempt-01.log"));
    expect(readFileSync(log, "utf8")).toContain("1 failed: invoiceRow header");
    expect(order).toEqual(["gate:pnpm typecheck", "gate:pnpm test"]);
    expect(backend.resumeCalls).toEqual([]);
    expect(head()).toBe(c2);
    expect(expectBackAtStop("gate-failed")).toMatchObject({ exitCode: 4, log });
    expect(read("src/invoiceRow.ts")).toBe(CORRECTED_HEADER);
  });

  it.each([
    {
      name: "a person's file without ## Guards",
      handoff: PERSON_HANDOFF.replace(/## Guards\n- test: [^\n]*\n\n/, ""),
      defect: 'missing section "## Guards"',
    },
    {
      name: "a person's file with three corrections and two guards",
      handoff: PERSON_HANDOFF.replace(
        "- The invoice header reads `Invoice number`.",
        "- The invoice header reads `Invoice number`.\n- The credit column is signed.\n- The total is rounded.",
      ).replace(
        "- test: tests/invoiceRow.test.ts",
        "- test: tests/invoiceRow.test.ts\n- no guard: by eye.",
      ),
      defect: '"## Guards" holds 2 entries for 3 corrections: one guard per correction, in order',
    },
  ])("refuses $name: exit 1, naming the defect, nothing committed", async ({ handoff, defect }) => {
    const c2 = head();
    correct();
    write(PERSON_HANDOFF_PATH, handoff);

    const error = refusal((await close()).result);

    expect(exitCodeForError(error)).toBe(1);
    expect(lastCloseOf(error, "handoff-invalid").defects).toContain(defect);
    expect(head()).toBe(c2);
    expectBackAtStop("handoff-invalid");
  });

  it("refuses a closing answer invalid twice after exactly one corrective resume: exit 5", async () => {
    const c2 = head();
    correct();
    const backend = makeFakeBackend().impl;
    backend.addResumeResponse({
      sessionId: "X0" as ClaudeSessionId,
      outputPath: "",
      finalText: "Looks good!",
    });
    backend.addResumeResponse({
      sessionId: "X0" as ClaudeSessionId,
      outputPath: "",
      finalText: "{}",
    });

    const error = refusal((await close({ backend })).result);

    expect(exitCodeForError(error)).toBe(5);
    expect(error.lastClose.result).toBe("closing-answer-invalid");
    expect(backend.resumeCalls.map((c) => c.options.outputJsonlPath)).toEqual([
      join(phaseFolder(), "closing-turn-01.jsonl"),
      join(phaseFolder(), "closing-turn-01-retry.jsonl"),
    ]);
    expect(backend.runCalls).toEqual([]);
    expect(head()).toBe(c2);
    expectBackAtStop("closing-answer-invalid");
  });

  it("refuses a closing turn that creates a file, setting it aside and restoring the worktree: exit 5", async () => {
    const c2 = head();
    correct();
    const onResume = () => write("src/export/labels.ts", "export const labels = {};\n");

    const error = refusal((await close({ backend: answering(), onResume })).result);

    expect(exitCodeForError(error)).toBe(5);
    expect(error.lastClose).toMatchObject({
      result: "closing-turn-edited",
      exitCode: 5,
      paths: ["src/export/labels.ts"],
    });
    expect(existsSync(join(tree(), "src/export/labels.ts"))).toBe(false);
    expect(read("src/invoiceRow.ts")).toBe(CORRECTED_HEADER);
    expect(
      readFileSync(join(phaseFolder(), "refused-turn-01", "src/export/labels.ts"), "utf8"),
    ).toBe("export const labels = {};\n");
    expect(head()).toBe(c2);
    expectBackAtStop("closing-turn-edited");
  });

  it("refuses a usage limit at closing, naming its reset time: exit 8, the stop kept", async () => {
    const c2 = head();
    correct();
    const backend = makeFakeBackend().impl;
    backend.failNextResumeWithRateLimit({ kind: "usage_limit", resetAt: "2026-10-23T18:00:00Z" });

    const error = refusal((await close({ backend })).result);

    expect(exitCodeForError(error)).toBe(8);
    expect(error.lastClose).toMatchObject({ result: "limit", resetAt: "2026-10-23T18:00:00Z" });
    expect(renderStopCloseRefused("phase-02", error.lastClose)).toContain("2026-10-23T18:00:00Z");
    expect(backend.runCalls).toEqual([]);
    expect(head()).toBe(c2);
    expectBackAtStop("limit");
  });

  it("refuses a commit the person made on C2, naming C2 and the soft reset", async () => {
    const c2 = head();
    correct();
    gitIn(tree(), "add", "-A");
    gitIn(tree(), "commit", "-m", "wip: by hand");
    const moved = head();

    const { result, order } = await close();
    const error = refusal(result);

    expect(order).toEqual([]);
    const { detail } = lastCloseOf(error, "close-error");
    expect(error.lastClose).toMatchObject({ exitCode: 1, step: "commit" });
    expect(detail).toContain(`HEAD moved from phase-02's commit ${c2} to ${moved}`);
    expect(detail).toContain(`git -C '${tree()}' reset --soft ${c2}`);
    // phax rewrites no history: the person's commit stays.
    expect(head()).toBe(moved);
    expectBackAtStop("close-error");
    expect(readJson(reviewStopPath())["closeBase"]).toBeNull();
  });
});

// ── A close interrupted ────────────────────────────────────────────────────

describe("a held close taken up again", () => {
  it("finishes a close interrupted after its review commit, from the Held-Phase commit", async () => {
    const c2 = head();
    correct();
    const gateLog = join(phaseFolder(), "review-gate", "checks-attempt-01.log");
    const landed = await Effect.runPromise(
      Effect.gen(function* () {
        yield* resumeRequested();
        // The close recorded its base, wrote the handoff and committed, then stopped.
        const parked = readJson(parkedPath());
        writeFileSync(parkedPath(), JSON.stringify({ ...parked, closeBase: c2 }, null, 2));
        writeFileSync(join(phaseFolder(), "correction-handoff.md"), PERSON_HANDOFF);
        const snapshot = yield* realGit.snapshotWorktree(tree());
        return yield* realGit.commitTree(
          tree(),
          snapshot,
          phase02().commit.subject,
          buildHeldReviewCommitBody({
            phase: phase02(),
            runId: run.runId,
            shortName: SHORT,
            worktreePath: tree(),
            gateLogPath: gateLog,
          }),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            NodeFileSystemLayer,
            NodeGitLayer,
            NodeShellLayer,
            NoopSystemTelemetryLayer,
          ),
        ),
      ),
    );

    const { result, order } = await close({ resume: false });
    const closed = report(result);

    expect(order).toEqual([]);
    expect(head()).toBe(landed);
    expect(gitIn(tree(), "rev-list", "--count", `${c2}..HEAD`)).toBe("1");
    expect(closed).toMatchObject({
      cause: "held",
      outcome: "corrected",
      phaseCommit: c2,
      reviewCommit: landed,
      handoffSource: "earlier-close",
      gateLog,
      changedPaths: ["src/invoiceRow.ts", "tests/invoiceRow.test.ts"],
    });
    expect(inFolder("review-diff.patch")).toContain("+export const header = 'Invoice number';");
    expect(correctionReconciliation()).toMatchObject({
      reviewCorrections: ["src/invoiceRow.ts", "tests/invoiceRow.test.ts"],
    });
    expect(phaseStatus()).toMatchObject({
      state: "committed",
      commitHash: c2,
      stop: { cause: "held", status: "closed", outcome: "corrected", reviewCommit: landed },
    });
  });
});

// ── §8: who made the edit does not matter ──────────────────────────────────

describe(
  "two identical held stops, corrected directly and through enter-phase",
  { timeout: 60_000 },
  () => {
    it("give review commits with the same tree and equal correction reconciliations", async () => {
      const otherWorld = createHeldWorld();
      try {
        vi.stubEnv("HOME", otherWorld.home);
        const entered = await heldAtPhase02(otherWorld);

        correct(run);
        // The continued session `phax enter-phase` spawns writes the same bytes.
        sessionLayer.current = Layer.succeed(Session, {
          resume: (invocation) =>
            Effect.sync(() => {
              correct(entered);
              expect(invocation.cwd).toBe(tree(entered));
              return 0;
            }),
        });
        const { loadConfig } = await import("../../src/app/loadConfig.js");
        vi.mocked(loadConfig).mockReturnValue(Either.right(entered.config));
        const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
        const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
        expect(await runEnterPhase(SHORT, "phase-02", quiet, {})).toBe(0);

        for (const r of [run, entered]) write(PERSON_HANDOFF_PATH, PERSON_HANDOFF, r);
        const a = report((await close({ run })).result);
        const b = report((await close({ run: entered })).result);

        expect(a.outcome).toBe("corrected");
        expect(b.outcome).toBe("corrected");
        expect(gitIn(tree(run), "rev-parse", "HEAD^{tree}")).toBe(
          gitIn(tree(entered), "rev-parse", "HEAD^{tree}"),
        );
        expect(correctionReconciliation(run)).toEqual(correctionReconciliation(entered));
      } finally {
        otherWorld.cleanup();
      }
    });
  },
);

// ── §8: the stop's files are never committed ──────────────────────────────

describe("the run's branches after a held close", () => {
  it("hold no path under .phax-context/ and none of the stop's documents", async () => {
    correct();
    write(PERSON_HANDOFF_PATH, PERSON_HANDOFF);

    report((await close()).result);

    const branches = gitIn(
      world.repoRoot,
      "branch",
      "--list",
      "--format=%(refname:short)",
      `phax/${SHORT}*`,
    )
      .split("\n")
      .filter((b) => b.length > 0);
    expect(branches).toContain(`phax/${SHORT}--phase-02`);
    for (const branch of branches) {
      const paths = gitIn(world.repoRoot, "ls-tree", "-r", "--name-only", branch).split("\n");
      expect(paths.filter((p) => p.startsWith(".phax-context/"))).toEqual([]);
      for (const name of ["interactive-session.json", "review-stop.json", "first-reading.md"]) {
        expect(paths.filter((p) => p.endsWith(name))).toEqual([]);
      }
    }
    expect(gitIn(tree(), "show", "--name-only", "--format=", "HEAD")).not.toContain(
      ".phax-context",
    );
  });
});

// ── The closing turn through the provider CLIs ─────────────────────────────

function providerConfig(codexPath: string): ProviderConfig {
  return {
    providers: {
      "claude-code": { enabled: true, executable: "claude" },
      "codex-cli": {
        enabled: true,
        executable: codexPath,
        families: {
          "openai-gpt": {
            models: [{ id: "gpt-6-luna", efforts: ["low", "medium", "high"], status: "active" }],
          },
        },
      },
    },
  };
}

describe("a held closing turn through the provider CLIs", () => {
  function cliClose(codexPath: string) {
    return close({
      backend: Effect.runSync(
        Effect.provide(Backend, makeNodeBackendLayer(providerConfig(codexPath))),
      ),
    });
  }

  it("resumes the codex builder X0 with exec resume, the read-only sandbox and no approval", async () => {
    const cli = makeFakeProviderCli(join(world.root, "cli"));
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
    cli.setScript({ sessionId: "X0", finalText: answerText() });
    correct();

    const closed = report((await cliClose(cli.codexPath)).result);

    const [call, ...more] = cli.invocations();
    expect(more).toEqual([]);
    expect(call).toEqual({
      executable: "codex",
      cwd: tree(),
      argv: [
        "exec",
        "resume",
        "X0",
        "--json",
        "--skip-git-repo-check",
        "-c",
        `sandbox_mode="read-only"`,
        "-c",
        `approval_policy="never"`,
        "-m",
        "gpt-6-luna",
        "-c",
        `model_reasoning_effort="medium"`,
      ],
    });
    expect(call!.argv.join(" ")).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(closed).toMatchObject({ outcome: "corrected", handoffSource: "closing-turn-resumed" });
  });

  it("resumes a Claude builder X0 with its reading tools and no shell, costing that turn alone", async () => {
    const cli = makeFakeProviderCli(join(world.root, "cli"));
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
    patchSession({
      provider: "claude-code",
      interactiveResume: "verified",
      current: {
        ...(readJson(join(phaseFolder(), "interactive-session.json"))["current"] as object),
        provider: "claude-code",
        model: "claude-sonnet-5-5",
        effort: "medium",
      },
    });
    // The builder's entries, as its headless turns recorded them.
    const builderStream = [
      { type: "system", subtype: "init", session_id: "X0", model: "claude-sonnet-5-5", tools: [] },
      {
        type: "assistant",
        session_id: "X0",
        message: {
          id: "msg_builder",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [{ type: "text", text: "done" }],
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    const ledgerPath = join(run.runPath, "cost-ledger.json");
    const seeded = nextLedger(
      {
        role: "phase",
        phase: "phase-02",
        runId: run.runId,
        runPath: run.runPath,
        provider: "claude-code",
        streamPath: join(phaseFolder(), "output.jsonl"),
      },
      builderStream,
      { entries: [] },
      1000,
      "2026-10-23T10:00:00.000Z",
    );
    expect(seeded).not.toBeNull();
    writeFileSync(ledgerPath, seeded!);
    const builderEntries = readJson(ledgerPath)["entries"] as unknown[];
    cli.setScript({ sessionId: "X0", finalText: answerText() });
    correct();

    const closed = report((await cliClose(cli.codexPath)).result);

    const [call, ...more] = cli.invocations();
    expect(more).toEqual([]);
    expect(call).toEqual({
      executable: "claude",
      cwd: tree(),
      argv: [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "default",
        "--tools",
        "Read,Grep,Glob",
        "--strict-mcp-config",
        "--model",
        "claude-sonnet-5-5",
        "--effort",
        "medium",
        "--resume",
        "X0",
      ],
    });
    expect(closed).toMatchObject({ outcome: "corrected", handoffSource: "closing-turn-resumed" });

    const entries = readJson(ledgerPath)["entries"] as Record<string, unknown>[];
    expect(entries.slice(0, builderEntries.length)).toEqual(builderEntries);
    const added = entries.slice(builderEntries.length);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      role: "closing-turn",
      phase: "phase-02",
      models: { "claude-sonnet-5-5": { inputTokens: 10, outputTokens: 5 } },
    });
  });
});
