import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeStop, type CloseReport } from "../../src/app/closeStop.js";
import { nextLedger } from "../../src/app/costLedger.js";
import { dispatch } from "../../src/app/dispatcher.js";
import type { PhaseId, RunId } from "../../src/domain/branded.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeNodeBackendLayer } from "../../src/infra/claudeCli.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend } from "../../src/ports/backend.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { CostLedger } from "../../src/schemas/costLedger.js";
import { currentSchemaUrl, readCostLedgerFile } from "../../src/schemas/persisted.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import {
  SHORT,
  createHeldWorld,
  startHeldRun,
  worktreeOf,
  readJson as readHeldJson,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";
import { providerStoreRootsUnder } from "../helpers/providerStoreRoots.js";
import { createWorld, stopRun, type StoppedRun, type World } from "../helpers/stoppedRunFixture.js";

// Only phax's own turns are costed, each by its own increment. A declared
// phase-03 whose first turn started Claude session C1, which the person then
// continued, is closed by a turn that resumes C1: the stream reports $1.40 for
// the whole session, and the ledger holds the closing turn's own $0.30. A held
// phase-02 built in X0 is closed the same way. Real git, the real file system,
// the real Claude backend over a fake `claude` that keeps its session store
// under the test's own HOME; the scripted gate shell runs only `pnpm`.

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/infra/session.js", () => ({ makeNodeSessionLayer: () => undefined }));
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

const SESSION_C1 = "C1";
const SESSION_X0 = "X0";
const MODEL = "claude-sonnet-5-5";

const GATE_STEPS: readonly GateStep[] = [
  { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
  { command: "pnpm test", surface: "local", firing: "every-phase", output: "log" },
  { command: "pnpm e2e", surface: "product", firing: "terminal", output: "log" },
];

const PHASE_03: PhaxPlanPhase = {
  id: "phase-03",
  title: "Review the export record",
  model: MODEL,
  effort: "medium",
  planMarkdownAnchor: "#phase-03",
  plannedFilesToCreate: [],
  plannedFilesToEdit: [],
  optionalFilesToEdit: [],
  mode: "interactive",
  oracle: null,
  testLines: [],
  commit: { subject: "feat(export): review the export record", body: "Made-up body." },
};

const CORRECTED_HEADER = "export const header = 'Invoice number';\n";

const answerText = (): string =>
  JSON.stringify({
    $schema: currentSchemaUrl("interactive-handoff"),
    corrections: [
      {
        what: "The invoice header reads `Invoice number`",
        guard: { kind: "test", ref: "tests/invoiceRow.test.ts" },
      },
    ],
    patternFromNowOn: ["Column headers are human-readable"],
    nextPhasesNeedToKnow: ["phase-04 copies the header wording"],
  });

// 30 000 output tokens at Sonnet's $10 per MTok: the closing turn's own $0.30.
const CLOSING_MESSAGE_USAGE = {
  input_tokens: 0,
  output_tokens: 30_000,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
} as const;

// The whole session so far, the person's turns included: 140 000 output tokens, $1.40.
const CUMULATIVE_RESULT = {
  [MODEL]: {
    inputTokens: 100,
    outputTokens: 140_000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 1.4,
  },
} as const;

const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));

// `pnpm` gate steps pass; every other command (git) runs for real.
const passingShell = Layer.succeed(Shell, {
  run: (options) =>
    options.command[0] !== "pnpm"
      ? realShell.run(options)
      : Effect.succeed({ exitCode: 0, stdout: "", stderr: "", stdoutEncoding: "utf8" as const }),
});

/** Claude's own store file for `sessionId`, which a continued session grows. */
function storeFile(cli: FakeProviderCli, cwd: string, sessionId: string): string {
  return join(
    cli.env["HOME"]!,
    ".claude",
    "projects",
    cwd.replace(/[^A-Za-z0-9]/g, "-"),
    `${sessionId}.jsonl`,
  );
}

function assistantLine(sessionId: string, id: string, outputTokens: number): string {
  return JSON.stringify({
    type: "assistant",
    session_id: sessionId,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: MODEL,
      content: [{ type: "text", text: "made-up" }],
      usage: {
        input_tokens: 10,
        output_tokens: outputTokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  });
}

/** A turn phax ran, as its stream holds it: an init and one assistant message. */
function turnStream(sessionId: string, outputTokens: number): string {
  return [
    JSON.stringify({ type: "system", subtype: "init", session_id: sessionId, model: MODEL }),
    assistantLine(sessionId, "msg_phax_turn", outputTokens),
  ].join("\n");
}

/** Append the first-turn or builder entry its turn recorded, as `withInvocationCost` writes it. */
function seedEntry(
  runPath: string,
  role: "phase" | "first-turn",
  phase: string,
  runId: string,
  streamText: string,
): void {
  const ledgerPath = join(runPath, "cost-ledger.json");
  let ledger: CostLedger = { entries: [] };
  try {
    ledger = Either.getOrThrow(
      readCostLedgerFile(ledgerPath, JSON.parse(readFileSync(ledgerPath, "utf8"))),
    );
  } catch {
    // No ledger yet.
  }
  const next = nextLedger(
    { role, phase, runId: runId as RunId, runPath, provider: "claude-code", streamPath: "" },
    streamText,
    ledger,
    1000,
    "2026-10-23T10:00:00.000Z",
  );
  expect(next).not.toBeNull();
  writeFileSync(ledgerPath, next!);
}

interface LedgerRow {
  readonly role: string;
  readonly phase: string | null;
  readonly sessionId: string;
  readonly costUsd: number;
  readonly models: Record<string, { outputTokens: number }>;
}

const entriesOf = (runPath: string): LedgerRow[] =>
  (JSON.parse(readFileSync(join(runPath, "cost-ledger.json"), "utf8")) as { entries: LedgerRow[] })
    .entries;

const outputTokensOf = (rows: readonly LedgerRow[]): number =>
  rows.reduce(
    (sum, row) => sum + Object.values(row.models).reduce((s, m) => s + m.outputTokens, 0),
    0,
  );

function claudeBackend() {
  return Effect.runSync(Effect.provide(Backend, makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG)));
}

// ── A declared phase-03 whose session the person continued ─────────────────

describe("a declared stop closed after the person continued C1", { timeout: 30_000 }, () => {
  let world: World;
  let cli: FakeProviderCli;

  beforeEach(() => {
    world = createWorld();
    cli = makeFakeProviderCli(join(world.root, "cli"));
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    world.cleanup();
  });

  async function closeDeclared(run: StoppedRun): Promise<CloseReport> {
    const program = Effect.gen(function* () {
      yield* dispatch(
        {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          run: run.shortName as unknown as RunId,
          phase: "phase-03" as PhaseId,
          type: "RunResumeRequested",
        },
        {
          runPath: run.runPath,
          shortName: run.shortName,
          phaseFolderPath: run.phaseFolder,
          phaseId: "phase-03",
        },
      );
      return yield* closeStop({
        runId: run.runId as RunId,
        shortName: run.shortName,
        runPath: run.runPath,
        phase: PHASE_03,
        phaseFolder: run.phaseFolder,
        worktree: run.worktree,
        gateSteps: GATE_STEPS,
        gateRequest: Effect.succeed("{}"),
        fileReconciliationMode: "report_only" as const,
        phases: [PHASE_03],
        oracles: null,
        mainCheckout: run.world.repoRoot,
      });
    });
    return Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Backend, claudeBackend()),
            NodeFileSystemLayer,
            NodeGitLayer,
            passingShell,
            NoopSystemTelemetryLayer,
            providerStoreRootsUnder(cli.env["HOME"]!),
          ),
        ),
      ),
    );
  }

  it("holds one first-turn and one closing-turn entry, the closing turn at its own $0.30 and not the cumulative $1.40, with nothing for the person's turns", async () => {
    const run = await stopRun(world, { sessionId: SESSION_C1 });
    // The first turn started C1: its entry, and C1 in the provider's own
    // store, which the person then continued with a large turn of their own.
    seedEntry(run.runPath, "first-turn", "phase-03", run.runId, turnStream(SESSION_C1, 5));
    const store = storeFile(cli, run.worktree, SESSION_C1);
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, `${turnStream(SESSION_C1, 5)}\n`);
    appendFileSync(store, `${assistantLine(SESSION_C1, "msg_person_turn", 110_000)}\n`);
    const phaseFilesBefore = JSON.stringify(
      JSON.parse(readFileSync(join(run.phaseFolder, "status.json"), "utf8")),
    );
    expect(phaseFilesBefore).toContain("phase-03");
    writeFileSync(join(run.worktree, "src", "invoiceRow.ts"), CORRECTED_HEADER);
    cli.setScript({
      sessionId: SESSION_C1,
      finalText: answerText(),
      claudeCodeVersion: "2.1.302",
      assistantUsage: CLOSING_MESSAGE_USAGE,
      resultModelUsage: CUMULATIVE_RESULT,
    });

    const closed = await closeDeclared(run);

    expect(closed).toMatchObject({
      cause: "declared",
      outcome: "corrected",
      handoffSource: "closing-turn-resumed",
    });
    const [call, ...more] = cli.invocations();
    expect(more).toEqual([]);
    expect(call!.argv).toContain("--resume");
    expect(call!.argv).toContain(SESSION_C1);

    const rows = entriesOf(run.runPath).filter((row) => row.phase === "phase-03");
    expect(rows.map((row) => row.role).toSorted()).toEqual(["closing-turn", "first-turn"]);
    expect(rows.every((row) => row.sessionId === SESSION_C1)).toBe(true);
    const closing = rows.find((row) => row.role === "closing-turn")!;
    expect(closing.costUsd).toBe(0.3);
    expect(closing.models[MODEL]!.outputTokens).toBe(30_000);
    // Phax's turns alone: the person's 110 000 output tokens appear nowhere.
    expect(outputTokensOf(rows)).toBe(5 + 30_000);
    expect(rows.reduce((sum, row) => sum + row.costUsd, 0)).toBeLessThan(0.31);
    expect(entriesOf(run.runPath)).toHaveLength(2);
  });
});

// ── A held phase-02 closed by a turn that resumes its builder ──────────────

describe("a held stop closed by a turn that resumes its builder", { timeout: 30_000 }, () => {
  let world: HeldWorld;
  let cli: FakeProviderCli;
  let run: HeldRun;

  beforeEach(async () => {
    world = createHeldWorld();
    vi.stubEnv("HOME", world.home);
    const started = await startHeldRun(world, { selection: "listed", phases: ["phase-02"] });
    run = started.run;
    expect(readHeldJson(join(run.runPath, "run-status.json"))["state"]).toBe("awaiting_review");
    cli = makeFakeProviderCli(join(world.root, "cli"));
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
  }, 30_000);

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    world.cleanup();
  });

  it("keeps the builder's entries as they were and adds one closing-turn entry of its own increment", async () => {
    const phaseFolder = join(run.runPath, "phase-02");
    const tree = worktreeOf(run, "phase-02");
    // The builder ran on Claude Code in X0: its entry, as its headless turn
    // recorded it, and X0 in the provider's store with a turn of the person's.
    const sessionPath = join(phaseFolder, "interactive-session.json");
    const session = readHeldJson(sessionPath);
    writeFileSync(
      sessionPath,
      JSON.stringify({
        ...session,
        provider: "claude-code",
        interactiveResume: "verified",
        current: {
          ...(session["current"] as object),
          provider: "claude-code",
          model: MODEL,
          effort: "medium",
        },
      }),
    );
    seedEntry(run.runPath, "phase", "phase-02", run.runId, turnStream(SESSION_X0, 500));
    const builderEntries = entriesOf(run.runPath);
    const store = storeFile(cli, tree, SESSION_X0);
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, `${turnStream(SESSION_X0, 500)}\n`);
    appendFileSync(store, `${assistantLine(SESSION_X0, "msg_person_turn", 110_000)}\n`);
    writeFileSync(join(tree, "src", "invoiceRow.ts"), CORRECTED_HEADER);
    cli.setScript({
      sessionId: SESSION_X0,
      finalText: answerText(),
      claudeCodeVersion: "2.1.302",
      assistantUsage: CLOSING_MESSAGE_USAGE,
      resultModelUsage: CUMULATIVE_RESULT,
    });

    const program = Effect.gen(function* () {
      yield* dispatch(
        {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          run: SHORT as unknown as RunId,
          phase: "phase-02" as PhaseId,
          type: "RunResumeRequested",
        },
        {
          runPath: run.runPath,
          shortName: SHORT,
          phaseFolderPath: phaseFolder,
          phaseId: "phase-02",
        },
      );
      return yield* Effect.either(
        closeStop({
          runId: run.runId,
          shortName: SHORT,
          runPath: run.runPath,
          phase: run.plan.phases[1]!,
          phaseFolder,
          worktree: tree,
          gateSteps: GATE_STEPS,
          gateRequest: Effect.succeed("{}"),
          fileReconciliationMode: "report_only" as const,
          phases: run.plan.phases,
          oracles: null,
          mainCheckout: world.repoRoot,
        }),
      );
    });
    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Backend, claudeBackend()),
            NodeFileSystemLayer,
            NodeGitLayer,
            passingShell,
            NoopSystemTelemetryLayer,
            providerStoreRootsUnder(cli.env["HOME"]!),
          ),
        ),
      ),
    );

    if (Either.isLeft(result)) throw new Error(`close refused: ${String(result.left)}`);
    expect(result.right).toMatchObject({ cause: "held", handoffSource: "closing-turn-resumed" });
    const [call, ...more] = cli.invocations();
    expect(more).toEqual([]);
    expect(call!.argv).toContain("--resume");
    expect(call!.argv).toContain(SESSION_X0);

    const entries = entriesOf(run.runPath);
    expect(entries.slice(0, builderEntries.length)).toEqual(builderEntries);
    const added = entries.slice(builderEntries.length);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      role: "closing-turn",
      phase: "phase-02",
      sessionId: SESSION_X0,
    });
    expect(added[0]!.costUsd).toBe(0.3);
    expect(outputTokensOf(entries)).toBe(500 + 30_000);
  });
});
