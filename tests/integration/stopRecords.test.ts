import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeStop } from "../../src/app/closeStop.js";
import { dispatch } from "../../src/app/dispatcher.js";
import { listRecords } from "../../src/app/recordsList.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { syncSaveInterruptedRun } from "../../src/cli/interruptHandler.js";
import type { PhaseId, RunId } from "../../src/domain/branded.js";
import {
  AwaitingReviewStopError,
  CleanupPausedError,
  StopRecordPausedError,
} from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend } from "../../src/ports/backend.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { RunHold } from "../../src/schemas/status.js";
import {
  SHORT,
  NAMESPACE,
  createHeldWorld,
  gitIn,
  invoiceExportPlan,
  readJson,
  readPhaseStatus,
  readRunStatus,
  resumeHeldRun,
  startHeldRun,
  worktreeOf,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";
import { providerStoreRootsUnder } from "../helpers/providerStoreRoots.js";
import {
  VIBE3_EXPORT_LONG,
  VIBE3_EXPORT_SHORT,
  VIBE3_SESSION_ID,
  vibe3ExportText,
} from "../helpers/vibe3Fixtures.js";

// The record of a stop, written once at closing, on the made-up invoice-export
// run: phase-02 held (`--hold phase-02`, built by codex in X0), phase-03
// declared interactive. The run loop is the real one; the fake backend plays
// every turn and keeps each session's transcript in its provider store.

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

const HOLD_PHASE_02: RunHold = { selection: "listed", phases: ["phase-02"] };
const NO_HOLD: RunHold = { selection: "none" };
const ADA = { name: "Ada Example", email: "ada@example.test" };

// Two lines the person and the agent said at the stop, one holding a secret.
const X1_TRANSCRIPT = [
  '{"type":"user","text":"the token is sk-example-ada-0001"}',
  '{"type":"assistant","text":"the InvoiceRow header reads invoice_no"}',
  "",
].join("\n");
const X0_TRANSCRIPT = '{"type":"assistant","text":"built the invoice CSV record"}\n';

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

let world: HeldWorld;
let others: HeldWorld[];

beforeEach(() => {
  world = createHeldWorld();
  others = [];
  vi.stubEnv("HOME", world.home);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  world.cleanup();
  for (const other of others) other.cleanup();
});

function failedWith<E>(result: Either.Either<unknown, unknown>, type: new (...a: never[]) => E): E {
  if (Either.isRight(result)) throw new Error("the run did not stop");
  expect(result.left).toBeInstanceOf(type);
  return result.left as E;
}

const phaseFolder = (run: HeldRun, phaseId: string): string => join(run.runPath, phaseId);

/** Turn records on with `records.transcript` as given; the repository answers private. */
function setTranscript(run: HeldRun, transcript: boolean): void {
  Object.assign(run.config, { records: { ...run.config.records, transcript } });
}

/** Replace the run's cleanup commands; the run reads them from its config each invocation. */
function setCleanup(run: HeldRun, cleanup: readonly string[]): void {
  (run.config.raw.commands as unknown as { cleanup: readonly string[] }).cleanup = cleanup;
}

/** The phase records of `phaseId` on the records branch. */
const recordsOf = (run: HeldRun, phaseId: string) =>
  Effect.runPromise(
    listRecords({
      records: run.config.records,
      repoRoot: run.config.repoRoot,
      publishRemote: run.config.publish.remote,
      runId: run.runId as string,
    }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer))),
  ).then((listed) =>
    listed.kind === "listed"
      ? listed.records.filter((r) => r.kind === "phase" && r.phaseId === phaseId)
      : [],
  );

const RECORDS_BRANCH = "phax/records/v1";

/** Every commit on the records branch, newest first. */
const recordCommits = (run: HeldRun): string[] =>
  gitIn(run.world.repoRoot, "rev-list", RECORDS_BRANCH).split("\n").filter(Boolean);

/** The manifest of `phaseId`'s record: each records commit holds only its own record. */
function manifestOf(run: HeldRun, phaseId: string): Record<string, unknown> {
  const key = `${run.runId as string}/${phaseId}`;
  const commit = recordCommits(run).find((c) =>
    gitIn(run.world.repoRoot, "ls-tree", "-r", "--name-only", c)
      .split("\n")
      .includes(`${key}/record.json`),
  );
  if (commit === undefined) throw new Error(`no record of ${phaseId}`);
  return JSON.parse(gitIn(run.world.repoRoot, "show", `${commit}:${key}/record.json`)) as Record<
    string,
    unknown
  >;
}

/** Every path and every file's text of every commit on the records branch. */
function recordsContent(run: HeldRun): { paths: string[]; texts: string[] } {
  const paths: string[] = [];
  const texts: string[] = [];
  for (const commit of recordCommits(run)) {
    for (const path of gitIn(run.world.repoRoot, "ls-tree", "-r", "--name-only", commit)
      .split("\n")
      .filter(Boolean)) {
      paths.push(path);
      texts.push(gitIn(run.world.repoRoot, "show", `${commit}:${path}`));
    }
  }
  return { paths, texts };
}

const sessionDoc = (run: HeldRun, phaseId: string) =>
  readJson(join(phaseFolder(run, phaseId), "interactive-session.json"));

/** The routed assignment model-resolution.json names for `phaseId`. */
const resolutionOf = (run: HeldRun, phaseId: string) =>
  readJson(join(phaseFolder(run, phaseId), "model-resolution.json"))["selected"] as {
    provider: string;
    concreteModel: string;
    thinking?: string;
  };

/** A declared run stopped at phase-03, records on, its first turn in session X1. */
async function declaredAtPhase03(
  opts: {
    readonly transcript?: boolean;
    readonly firstTurnFails?: boolean;
    readonly in?: HeldWorld;
  } = {},
): Promise<HeldRun> {
  const { run, result } = await startHeldRun(opts.in ?? world, NO_HOLD, {
    records: true,
    prepare: (prepared) => {
      prepared.backend.firstTurnSession = "X1";
      prepared.backend.firstTurnFails = opts.firstTurnFails ?? false;
      setTranscript(prepared, opts.transcript ?? false);
    },
  });
  failedWith(result, AwaitingReviewStopError);
  return run;
}

/** The person's correction at phase-03, left uncommitted in its worktree. */
function correctPhase03(run: HeldRun): void {
  writeFileSync(
    join(worktreeOf(run, "phase-03"), "src", "invoiceRow.ts"),
    "export const header = 'Invoice number';\n",
  );
}

describe(
  "a held phase's record (§8 A held phase's record is written once, at closing)",
  {
    timeout: 60_000,
  },
  () => {
    it("is absent while held, then written once naming C2, R2, the cause, the outcome, Ada Example and X0's digest", async () => {
      const { run, result } = await startHeldRun(world, HOLD_PHASE_02, { records: true });
      failedWith(result, AwaitingReviewStopError);
      const c2 = gitIn(worktreeOf(run, "phase-02"), "rev-parse", "HEAD");
      expect(await recordsOf(run, "phase-01")).toHaveLength(1);
      expect(await recordsOf(run, "phase-02")).toHaveLength(0);

      run.backend.transcripts.set("X0", X0_TRANSCRIPT);
      writeFileSync(
        join(worktreeOf(run, "phase-02"), "src", "invoiceRow.ts"),
        "export const header = 'Invoice number';\n",
      );
      failedWith(await resumeHeldRun(run), AwaitingReviewStopError);

      const r2 = gitIn(run.world.repoRoot, "rev-parse", `phax/${SHORT}--phase-02`);
      expect(r2).not.toBe(c2);
      expect(await recordsOf(run, "phase-02")).toHaveLength(1);
      const binding = readJson(join(phaseFolder(run, "phase-02"), "agent-binding.json"));
      expect(manifestOf(run, "phase-02")).toMatchObject({
        phaseId: "phase-02",
        sourceSha: c2,
        outcome: "committed",
        mode: "headless",
        provider: "codex-cli",
        stop: {
          cause: "held",
          outcome: "corrected",
          reviewCommit: r2,
          closedBy: ADA,
          sessions: [
            {
              provider: "codex-cli",
              model: binding["model"],
              effort: binding["effort"],
              sessionId: "X0",
              origin: "builder",
              transcript: { status: "captured", sha256: sha256(X0_TRANSCRIPT) },
            },
          ],
        },
      });
      // The headless phases before it name no stop.
      expect(manifestOf(run, "phase-01")).toMatchObject({ mode: "headless", stop: null });
    });

    it("emits a stop.record step for the record written at closing", async () => {
      const { run, result } = await startHeldRun(world, HOLD_PHASE_02, { records: true });
      failedWith(result, AwaitingReviewStopError);

      failedWith(await resumeHeldRun(run), AwaitingReviewStopError);

      const steps = run.telemetry.impl
        .events()
        .filter(
          (e) =>
            (e.type === "step.started" || e.type === "step.completed") &&
            "step" in e &&
            e.step === "stop.record",
        );
      expect(steps.map((e) => [e.type, "operationId" in e ? e.operationId : undefined])).toEqual([
        ["step.started", "phase-02"],
        ["step.completed", "phase-02"],
      ]);
    });
  },
);

describe(
  "a declared phase's record (§8 Records and the security record name the review honestly)",
  {
    timeout: 60_000,
  },
  () => {
    it("is written once at closing, naming the routed assignment, X1's digest, mode interactive, no usage and the declared commit", async () => {
      const run = await declaredAtPhase03({ transcript: true });
      run.backend.transcripts.set("X1", X1_TRANSCRIPT);
      expect(await recordsOf(run, "phase-03")).toHaveLength(0);
      const selected = resolutionOf(run, "phase-03");
      const current = (sessionDoc(run, "phase-03")["current"] ?? {}) as Record<string, unknown>;
      correctPhase03(run);

      const finished = await resumeHeldRun(run);

      expect(Either.isRight(finished)).toBe(true);
      expect(await recordsOf(run, "phase-03")).toHaveLength(1);
      const declaredCommit = readPhaseStatus(run, "phase-03")["commitHash"];
      expect(manifestOf(run, "phase-03")).toEqual({
        $schema: expect.stringMatching(
          /^https:\/\/docs\.phax\.run\/schemas\/phase-record-manifest\/\d+\.\d+\.\d+\.json$/,
        ),
        runId: run.runId,
        phaseId: "phase-03",
        shape: "skeleton",
        sourceSha: declaredCommit,
        model: selected.concreteModel,
        effort: selected.thinking ?? "medium",
        provider: selected.provider,
        outcome: "committed",
        usage: { available: false },
        verifiedSurfaces: expect.any(Array),
        oracle: null,
        mode: "interactive",
        stop: {
          cause: "declared",
          outcome: "corrected",
          closedBy: ADA,
          sessions: [
            {
              provider: current["provider"],
              model: current["model"],
              effort: current["effort"],
              sessionId: "X1",
              origin: "first-turn",
              transcript: { status: "captured", sha256: sha256(X1_TRANSCRIPT) },
            },
          ],
        },
      });
      // The copy stays in the run folder.
      expect(
        readFileSync(
          join(phaseFolder(run, "phase-03"), "interactive-transcripts", "X1.jsonl"),
          "utf8",
        ),
      ).toBe(X1_TRANSCRIPT);
    });

    it("names the phase's effort when model-resolution.json names no thinking level", async () => {
      const run = await declaredAtPhase03();
      const path = join(phaseFolder(run, "phase-03"), "model-resolution.json");
      const resolution = readJson(path) as { selected: Record<string, unknown> };
      delete resolution.selected["thinking"];
      writeFileSync(path, JSON.stringify(resolution, null, 2));

      const finished = await resumeHeldRun(run);

      expect(Either.isRight(finished)).toBe(true);
      expect(manifestOf(run, "phase-03")).toMatchObject({
        model: resolutionOf(run, "phase-03").concreteModel,
        effort: "medium",
        stop: { cause: "declared", outcome: "unchanged", closedBy: ADA },
      });
    });

    it("names X1 on one run and no session on a run whose first turn failed, and no records commit carries a transcript's content", async () => {
      const withX1 = await declaredAtPhase03({ transcript: true });
      withX1.backend.transcripts.set("X1", X1_TRANSCRIPT);
      const second = createHeldWorld();
      others.push(second);
      const failedTurn = await declaredAtPhase03({
        transcript: false,
        firstTurnFails: true,
        in: second,
      });
      failedTurn.backend.transcripts.set("X1", X1_TRANSCRIPT);

      expect(Either.isRight(await resumeHeldRun(withX1))).toBe(true);
      expect(Either.isRight(await resumeHeldRun(failedTurn))).toBe(true);

      expect(manifestOf(withX1, "phase-03")).toMatchObject({
        stop: {
          sessions: [
            {
              provider: resolutionOf(withX1, "phase-03").provider,
              sessionId: "X1",
              transcript: { status: "captured", sha256: sha256(X1_TRANSCRIPT) },
            },
          ],
        },
      });
      expect(manifestOf(failedTurn, "phase-03")).toMatchObject({
        mode: "interactive",
        stop: { cause: "declared", sessions: [] },
      });
      for (const run of [withX1, failedTurn]) {
        const { paths, texts } = recordsContent(run);
        expect(paths.filter((p) => p.includes("interactive-transcripts"))).toEqual([]);
        for (const line of X1_TRANSCRIPT.split("\n").filter(Boolean)) {
          expect(texts.some((text) => text.includes(line))).toBe(false);
        }
      }
      expect(
        existsSync(join(phaseFolder(withX1, "phase-03"), "interactive-transcripts", "X1.jsonl")),
      ).toBe(true);
    });

    it("names X1's transcript missing, not-found, when its rollout is gone (§8 A missing transcript never blocks closing)", async () => {
      const run = await declaredAtPhase03();
      // No transcript in the provider store: X1's rollout was deleted.

      expect(Either.isRight(await resumeHeldRun(run))).toBe(true);

      expect(manifestOf(run, "phase-03")).toMatchObject({
        stop: {
          sessions: [{ sessionId: "X1", transcript: { status: "missing", reason: "not-found" } }],
        },
      });
    });
  },
);

describe("a declared phase's record through interrupts and refusals", { timeout: 60_000 }, () => {
  // The disk a process killed between StopCommitted and the record leaves.
  async function closeAndInterrupt(run: HeldRun): Promise<void> {
    const phase = run.plan.phases[2]!;
    const greenShell = Layer.succeed(Shell, {
      run: (options) =>
        options.command[0] === "pnpm"
          ? Effect.succeed({ exitCode: 0, stdout: "", stderr: "", stdoutEncoding: "utf8" as const })
          : Effect.runSync(Effect.provide(Shell, NodeShellLayer)).run(options),
    });
    const program = Effect.gen(function* () {
      yield* dispatch(
        {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          run: SHORT as unknown as RunId,
          phase: "phase-03" as PhaseId,
          type: "RunResumeRequested",
        },
        {
          runPath: run.runPath,
          shortName: SHORT,
          phaseFolderPath: phaseFolder(run, "phase-03"),
          phaseId: "phase-03",
        },
      );
      return yield* closeStop({
        runId: run.runId,
        shortName: SHORT,
        runPath: run.runPath,
        phase,
        phaseFolder: phaseFolder(run, "phase-03"),
        worktree: worktreeOf(run, "phase-03"),
        gateSteps: [
          { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
        ],
        gateRequest: Effect.succeed("{}"),
        fileReconciliationMode: "report_only" as const,
        phases: run.plan.phases,
        oracles: null,
        mainCheckout: run.world.repoRoot,
      });
    });
    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Backend, run.backend),
            NodeFileSystemLayer,
            NodeGitLayer,
            greenShell,
            NoopSystemTelemetryLayer,
            providerStoreRootsUnder(run.world.home),
          ),
        ),
      ),
    );
    syncSaveInterruptedRun({
      namespace: NAMESPACE,
      shortName: SHORT,
      stateRoot: run.world.stateRoot,
    });
  }

  it("is written by the resume of a close interrupted after StopCommitted, and not again by the next resume", async () => {
    const run = await declaredAtPhase03();
    run.backend.transcripts.set("X1", X1_TRANSCRIPT);
    correctPhase03(run);
    await closeAndInterrupt(run);
    expect(readPhaseStatus(run, "phase-03")).toMatchObject({
      state: "committed",
      stop: { cause: "declared", status: "closed", outcome: "corrected", closedBy: ADA },
    });
    expect(await recordsOf(run, "phase-03")).toHaveLength(0);

    setCleanup(run, ["false"]);
    failedWith(await resumeHeldRun(run), CleanupPausedError);

    expect(await recordsOf(run, "phase-03")).toHaveLength(1);
    expect(manifestOf(run, "phase-03")).toMatchObject({
      sourceSha: readPhaseStatus(run, "phase-03")["commitHash"],
      mode: "interactive",
      stop: {
        cause: "declared",
        outcome: "corrected",
        closedBy: ADA,
        sessions: [{ sessionId: "X1", transcript: { sha256: sha256(X1_TRANSCRIPT) } }],
      },
    });

    setCleanup(run, ["touch .cleanup-marker"]);
    expect(Either.isRight(await resumeHeldRun(run))).toBe(true);
    expect(await recordsOf(run, "phase-03")).toHaveLength(1);
  });

  it("pauses the run when the records destination refuses it at closing (exit 1, stop_record_refused), and the next resume writes it once", async () => {
    const run = await declaredAtPhase03();
    // Transcripts in-repo on a public repository: the destination refuses.
    setTranscript(run, true);
    run.github.impl.setVisibility("public");

    const paused = failedWith(await resumeHeldRun(run), StopRecordPausedError);

    expect(exitCodeForError(paused)).toBe(1);
    expect(readRunStatus(run)).toMatchObject({
      state: "interrupted",
      stoppedReason: "stop_record_refused",
    });
    expect(readPhaseStatus(run, "phase-03")).toMatchObject({
      state: "committed",
      stop: { cause: "declared", status: "closed" },
    });
    expect(await recordsOf(run, "phase-03")).toHaveLength(0);
    expect(readFileSync(join(run.runPath, "resume-instructions.md"), "utf8")).toContain(
      `phax resume ${SHORT}`,
    );

    setTranscript(run, false);
    expect(Either.isRight(await resumeHeldRun(run))).toBe(true);

    expect(await recordsOf(run, "phase-03")).toHaveLength(1);
    expect(manifestOf(run, "phase-03")).toMatchObject({
      sourceSha: readPhaseStatus(run, "phase-03")["commitHash"],
      stop: { cause: "declared", outcome: "unchanged", sessions: [{ sessionId: "X1" }] },
    });
    expect(readPhaseStatus(run, "phase-03")["state"]).toBe("cleaned_up");
  });
});

const VIBE_CONFIG = {
  ...DEFAULT_PROVIDER_CONFIG,
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "mistral-vibe": { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, enabled: true },
  },
};

/** A turn's `export.json`, in the directory a vibe turn would have been given beside its transcript. */
const writeExport = (folder: string, exportDir: string, exported: string): void => {
  mkdirSync(join(folder, exportDir), { recursive: true });
  writeFileSync(join(folder, exportDir, "export.json"), exported);
};

describe("a held record's usage on mistral-vibe", { timeout: 60_000 }, () => {
  it("is the builder's usage read at the hold point, not the export a closing turn wrote", async () => {
    // The builder's turn wrote output.jsonl, so its export is output.vibe-export.
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02, {
      records: true,
      providerConfig: VIBE_CONFIG,
      // phase-02 is built by vibe, natively.
      plan: invoiceExportPlan({ "phase-02": "phax-mistral-medium-3.5-medium" }),
      prepare: (prepared) => {
        prepared.backend.builderSessions.set("phase-02", VIBE3_SESSION_ID);
        prepared.backend.onBuild = (phase) => {
          if (phase === "phase-02") {
            writeExport(
              phaseFolder(prepared, phase),
              "output.vibe-export",
              vibe3ExportText(VIBE3_EXPORT_SHORT),
            );
          }
        };
      },
    });
    failedWith(result, AwaitingReviewStopError);
    expect(readJson(join(phaseFolder(run, "phase-02"), "agent-binding.json"))).toMatchObject({
      provider: "mistral-vibe",
      sessionId: VIBE3_SESSION_ID,
    });

    // The closing turn resumes the session and writes an export of its own.
    run.backend.onReadOnly = (phase) => {
      if (phase === "phase-02") {
        writeExport(
          phaseFolder(run, phase),
          "closing-turn-01.vibe-export",
          vibe3ExportText(VIBE3_EXPORT_LONG),
        );
      }
    };
    writeFileSync(
      join(worktreeOf(run, "phase-02"), "src", "invoiceRow.ts"),
      "export const header = 'Invoice number';\n",
    );
    await resumeHeldRun(run);

    expect(manifestOf(run, "phase-02")).toMatchObject({
      provider: "mistral-vibe",
      usage: {
        available: true,
        usage: {
          provider: "mistral-vibe",
          inputTokens: 10987,
          cachedInputTokens: 3200,
          outputTokens: 3,
          costUsd: 0.016503,
        },
      },
      stop: { cause: "held", outcome: "corrected" },
    });
  });
});
