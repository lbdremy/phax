import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeStop } from "../../src/app/closeStop.js";
import { dispatch } from "../../src/app/dispatcher.js";
import { explainRecord } from "../../src/app/recordsExplain.js";
import { listRecords } from "../../src/app/recordsList.js";
import { syncSaveInterruptedRun } from "../../src/cli/interruptHandler.js";
import type { ClaudeSessionId, PhaseId, RunId } from "../../src/domain/branded.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import {
  AwaitingReviewStopError,
  CleanupPausedError,
  RateLimitError,
  RegistryCorruptionError,
  StopRecordPausedError,
} from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend } from "../../src/ports/backend.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { RunHold } from "../../src/schemas/status.js";
import {
  NAMESPACE,
  SHORT,
  backendCalls,
  createHeldWorld,
  gitIn,
  handoffOf,
  readJson,
  readPhaseStatus,
  readRunStatus,
  resumeHeldRun,
  startHeldRun,
  worktreeOf,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";

// The made-up invoice-export run holding phase-02 (`--hold phase-02`), run by
// the real run loop and closed by `resumeHeldRun`, the `phax resume` of a
// stopped run: the review commit, the record at closing, the cleanup, the
// next phase, a closed stop interrupted before its cleanup, and the prompts
// that read the corrections.

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
const HOLD_PHASES_02_04 = { selection: "listed", phases: ["phase-02", "phase-04"] } as const;

let world: HeldWorld;

beforeEach(() => {
  world = createHeldWorld();
  vi.stubEnv("HOME", world.home);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  world.cleanup();
});

const CORRECTED_HEADER = "export const header = 'Invoice number';\n";

const tree = (run: HeldRun, phaseId = "phase-02"): string => worktreeOf(run, phaseId);
const phaseFolder = (run: HeldRun, phaseId = "phase-02"): string => join(run.runPath, phaseId);
const headOf = (cwd: string): string => gitIn(cwd, "rev-parse", "HEAD");

function failedWith<E>(result: Either.Either<unknown, unknown>, type: new (...a: never[]) => E): E {
  if (Either.isRight(result)) throw new Error("the run did not stop");
  expect(result.left).toBeInstanceOf(type);
  return result.left as E;
}

/** The person's correction at phase-02, left uncommitted in its worktree. */
function correct(run: HeldRun): void {
  writeFileSync(join(tree(run), "src", "invoiceRow.ts"), CORRECTED_HEADER);
}

/** Replace the run's cleanup commands; the run reads them from its config each invocation. */
function setCleanup(run: HeldRun, cleanup: readonly string[]): void {
  (run.config.raw.commands as unknown as { cleanup: readonly string[] }).cleanup = cleanup;
}

async function heldAtPhase02(
  opts: { readonly records?: boolean; readonly hold?: RunHold } = {},
): Promise<{ run: HeldRun; c2: string }> {
  const { run, result } = await startHeldRun(world, opts.hold ?? HOLD_PHASE_02, {
    records: opts.records ?? false,
  });
  failedWith(result, AwaitingReviewStopError);
  return { run, c2: headOf(tree(run)) };
}

// The closing gate's `pnpm` steps are green and unrun; git and every other command run.
const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));
const greenGateShell = Layer.succeed(Shell, {
  run: (options) =>
    options.command[0] === "pnpm"
      ? Effect.succeed({ exitCode: 0, stdout: "", stderr: "", stdoutEncoding: "utf8" as const })
      : realShell.run(options),
});

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

// The record of the commit `sha` explains, or undefined.
async function explainedRecord(run: HeldRun, sha: string) {
  const result = await Effect.runPromise(
    explainRecord({
      sha,
      repoRoot: world.repoRoot,
      records: run.config.records,
      publishRemote: run.config.publish.remote,
    }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer))),
  );
  return result.kind === "found" ? result.record.manifest : undefined;
}

const runFailedTraced = (run: HeldRun): boolean =>
  run.telemetry.impl
    .events()
    .some(
      (e) =>
        JSON.stringify(e).includes('"RunFailed"') ||
        JSON.stringify(e).includes("dispatch.RunFailed"),
    );

describe("closing a held stop by phax resume", { timeout: 60_000 }, () => {
  it("leaves a review commit by Ada Example on C2, cleans up after the close and starts phase-03 at the review commit", async () => {
    const { run, c2 } = await heldAtPhase02();
    correct(run);

    const result = await resumeHeldRun(run);

    // phase-03 is declared interactive: the same invocation went on and stopped there.
    const error = failedWith(result, AwaitingReviewStopError);
    expect(error.phase).toBe("phase-03");
    expect(error.report.cause).toBe("declared");

    const branch = `phax/${SHORT}--phase-02`;
    const review = gitIn(world.repoRoot, "rev-parse", branch);
    expect(review).not.toBe(c2);
    expect(gitIn(world.repoRoot, "rev-parse", `${review}^`)).toBe(c2);
    expect(gitIn(world.repoRoot, "log", "-1", "--format=%an", review)).toBe("Ada Example");
    expect(gitIn(world.repoRoot, "log", "-1", "--format=%B", review)).toContain(
      "Held-Phase: phase-02",
    );
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "cleaned_up",
      commitHash: c2,
      stop: { cause: "held", status: "closed", outcome: "corrected", reviewCommit: review },
    });
    // The cleanup ran after the close, in the worktree the review commit sits in.
    expect(existsSync(join(tree(run), ".cleanup-marker"))).toBe(true);
    // The next phase starts from the branch tip, which is the review commit.
    expect(headOf(tree(run, "phase-03"))).toBe(review);
    expect(readRunStatus(run)["state"]).toBe("awaiting_review");
  });

  it("starts phase-03 at C2 when the review changed nothing, with no exit 9", async () => {
    const { run, c2 } = await heldAtPhase02();

    const error = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);

    expect(error.phase).toBe("phase-03");
    expect(headOf(tree(run, "phase-03"))).toBe(c2);
    expect(gitIn(world.repoRoot, "rev-parse", `phax/${SHORT}--phase-02`)).toBe(c2);
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "cleaned_up",
      commitHash: c2,
      stop: { cause: "held", status: "closed", outcome: "unchanged" },
    });
  });

  it("returns a red closing gate to the person, and closes on the next resume once it is fixed", async () => {
    const { run, c2 } = await heldAtPhase02();
    correct(run);
    run.failingGates.add("pnpm typecheck");

    const refused = await resumeHeldRun(run);

    expect(Either.isLeft(refused)).toBe(true);
    expect(exitCodeForError((refused as Either.Left<unknown, unknown>).left)).toBe(4);
    expect(readRunStatus(run)["state"]).toBe("awaiting_review");
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "awaiting_review",
      stop: { cause: "held", status: "waiting" },
    });
    expect(headOf(tree(run))).toBe(c2);
    expect(existsSync(join(run.runPath, "review-stop.json"))).toBe(true);

    run.failingGates.clear();
    const error = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);

    expect(error.phase).toBe("phase-03");
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "cleaned_up",
      stop: { status: "closed", outcome: "corrected" },
    });
  });
});

describe("the record of a held phase", { timeout: 60_000 }, () => {
  it("is absent while the phase is held, written once at closing, and names C2 and X0", async () => {
    const { run, c2 } = await heldAtPhase02({ records: true });
    expect(await recordsOf(run, "phase-01")).toHaveLength(1);
    expect(await recordsOf(run, "phase-02")).toHaveLength(0);

    correct(run);
    failedWith(await resumeHeldRun(run), AwaitingReviewStopError);

    expect(await recordsOf(run, "phase-02")).toHaveLength(1);
    const explained = await Effect.runPromise(
      explainRecord({
        sha: c2,
        repoRoot: world.repoRoot,
        records: run.config.records,
        publishRemote: run.config.publish.remote,
      }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer))),
    );
    expect(explained.kind).toBe("found");
    if (explained.kind !== "found") return;
    expect(explained.record.manifest).toMatchObject({
      phaseId: "phase-02",
      sourceSha: c2,
      outcome: "committed",
      provider: "codex-cli",
    });
    const binding = explained.record.artifacts.get("agent-binding.json");
    expect(binding === undefined ? "" : new TextDecoder().decode(binding)).toContain("X0");
    // The stop's own files are not the agent's work.
    for (const name of ["correction-handoff.md", "review-seed.md", "interactive-session.json"]) {
      expect(explained.record.artifacts.has(name)).toBe(false);
    }
  });

  // The disk a process killed between HeldStopClosed and the cleanup leaves.
  async function closeAndInterrupt(run: HeldRun): Promise<void> {
    const backend = makeFakeBackend().impl;
    backend.addResumeResponse({
      sessionId: "X0" as ClaudeSessionId,
      outputPath: "",
      finalText: JSON.stringify({
        $schema: currentSchemaUrl("interactive-handoff"),
        corrections: [
          {
            what: "The invoice header reads `Invoice number`",
            guard: { kind: "test", ref: "tests/invoiceRow.test.ts" },
          },
        ],
        patternFromNowOn: ["Column headers are human-readable"],
        nextPhasesNeedToKnow: ["phase-04 copies the header wording"],
      }),
    });
    const phase = run.plan.phases[1]!;
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
          phaseFolderPath: phaseFolder(run),
          phaseId: "phase-02",
        },
      );
      return yield* closeStop({
        runId: run.runId,
        shortName: SHORT,
        runPath: run.runPath,
        phase,
        phaseFolder: phaseFolder(run),
        worktree: tree(run),
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
            Layer.succeed(Backend, backend),
            NodeFileSystemLayer,
            NodeGitLayer,
            greenGateShell,
            NoopSystemTelemetryLayer,
          ),
        ),
      ),
    );
    syncSaveInterruptedRun({ namespace: NAMESPACE, shortName: SHORT, stateRoot: world.stateRoot });
  }

  it("is written on the resume of a close interrupted before its cleanup, once, and the run goes on", async () => {
    const { run, c2 } = await heldAtPhase02({ records: true });
    correct(run);
    await closeAndInterrupt(run);
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "committed",
      stop: { cause: "held", status: "closed" },
    });
    expect(await recordsOf(run, "phase-02")).toHaveLength(0);
    expect(existsSync(join(tree(run), ".cleanup-marker"))).toBe(false);

    const error = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);

    expect(error.phase).toBe("phase-03");
    const records = await recordsOf(run, "phase-02");
    expect(records).toHaveLength(1);
    expect(existsSync(join(tree(run), ".cleanup-marker"))).toBe(true);
    expect(readPhaseStatus(run, "phase-02")["state"]).toBe("cleaned_up");
    expect(c2).toBe(readPhaseStatus(run, "phase-02")["commitHash"]);
  });

  it("pauses the run when the records destination refuses it at closing, and is written once by the next resume", async () => {
    const { run, c2 } = await heldAtPhase02({ records: true });
    correct(run);
    // Transcripts in-repo on a public repository: the destination refuses.
    const records = run.config.records;
    Object.assign(run.config, { records: { ...records, transcript: true } });
    run.github.impl.setVisibility("public");

    const paused = failedWith(await resumeHeldRun(run), StopRecordPausedError);

    expect(exitCodeForError(paused)).toBe(1);
    expect(paused.message).toContain("set a records repo, or disable transcripts");
    expect(readRunStatus(run)).toMatchObject({
      state: "interrupted",
      stoppedReason: "stop_record_refused",
    });
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "committed",
      commitHash: c2,
      stop: { cause: "held", status: "closed", outcome: "corrected" },
    });
    expect(await recordsOf(run, "phase-02")).toHaveLength(0);
    expect(existsSync(join(tree(run), ".cleanup-marker"))).toBe(false);
    expect(readFileSync(join(run.runPath, "resume-instructions.md"), "utf8")).toContain(
      `phax resume ${SHORT}`,
    );
    expect(runFailedTraced(run)).toBe(false);

    Object.assign(run.config, { records });
    const error = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);

    expect(error.phase).toBe("phase-03");
    expect(await recordsOf(run, "phase-02")).toHaveLength(1);
    expect(await explainedRecord(run, c2)).toMatchObject({
      phaseId: "phase-02",
      sourceSha: c2,
      outcome: "committed",
    });
    expect(existsSync(join(tree(run), ".cleanup-marker"))).toBe(true);
    expect(readPhaseStatus(run, "phase-02")["state"]).toBe("cleaned_up");
  });

  it("leaves an interrupted closed stop resumable when what its record needs cannot be read", async () => {
    const { run } = await heldAtPhase02({ records: true });
    correct(run);
    await closeAndInterrupt(run);
    const bindingPath = join(phaseFolder(run), "agent-binding.json");
    const binding = readFileSync(bindingPath, "utf8");
    writeFileSync(bindingPath, "{");
    const before = readFileSync(join(run.runPath, "run-status.json"), "utf8");

    failedWith(await resumeHeldRun(run), RegistryCorruptionError);

    expect(readFileSync(join(run.runPath, "run-status.json"), "utf8")).toBe(before);
    expect(readRunStatus(run)["state"]).toBe("interrupted");
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "committed",
      stop: { cause: "held", status: "closed" },
    });
    expect(runFailedTraced(run)).toBe(false);

    writeFileSync(bindingPath, binding);
    failedWith(await resumeHeldRun(run), AwaitingReviewStopError);
    expect(await recordsOf(run, "phase-02")).toHaveLength(1);
  });

  it("writes no failed record and no RunFailed when HeldStopClosed cannot be persisted, and one record naming C2 later", async () => {
    const { run, c2 } = await heldAtPhase02({ records: true });
    correct(run);
    // The first write of phase-02's status as committed (HeldStopClosed's) fails once.
    const statusPath = join(phaseFolder(run), "status.json");
    run.failWrite = (path, content) => {
      if (path !== statusPath || (JSON.parse(content) as { state?: string }).state !== "committed")
        return false;
      run.failWrite = undefined;
      return true;
    };

    const failed = await resumeHeldRun(run);

    expect(Either.isLeft(failed)).toBe(true);
    expect(run.failWrite).toBeUndefined();
    expect(readRunStatus(run)["state"]).not.toBe("failed");
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "awaiting_review",
      stop: { cause: "held", status: "waiting" },
    });
    expect(await recordsOf(run, "phase-02")).toHaveLength(0);
    expect(runFailedTraced(run)).toBe(false);

    failedWith(await resumeHeldRun(run), AwaitingReviewStopError);

    const records = await recordsOf(run, "phase-02");
    expect(records).toHaveLength(1);
    expect(await explainedRecord(run, c2)).toMatchObject({
      phaseId: "phase-02",
      sourceSha: c2,
      outcome: "committed",
    });
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "cleaned_up",
      commitHash: c2,
      stop: { cause: "held", status: "closed", outcome: "corrected" },
    });
  });

  it("is not written twice by a held phase that paused in cleanup after its close", async () => {
    const { run } = await heldAtPhase02({ records: true });
    setCleanup(run, ["false"]);

    const paused = failedWith(await resumeHeldRun(run), CleanupPausedError);

    expect(paused.phaseId).toBe("phase-02");
    expect(await recordsOf(run, "phase-02")).toHaveLength(1);

    setCleanup(run, ["touch .cleanup-marker"]);
    failedWith(await resumeHeldRun(run), AwaitingReviewStopError);

    expect(await recordsOf(run, "phase-02")).toHaveLength(1);
    expect(readPhaseStatus(run, "phase-02")["state"]).toBe("cleaned_up");
  });
});

describe("the hold stays fixed for the run", { timeout: 60_000 }, () => {
  it("holds phase-04 as well, and the run-status hold bytes never change", async () => {
    const { run } = await heldAtPhase02({ hold: HOLD_PHASES_02_04 });
    const hold = (): string => JSON.stringify(readRunStatus(run)["hold"]);
    const before = hold();
    expect(JSON.parse(before)).toEqual({ selection: "listed", phases: ["phase-02", "phase-04"] });

    // phase-02 closes; the declared phase-03 stops, then closes; phase-04 holds.
    failedWith(await resumeHeldRun(run), AwaitingReviewStopError);
    expect(hold()).toBe(before);
    const held04 = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);
    expect(held04.phase).toBe("phase-04");
    expect(held04.report.cause).toBe("held");
    expect(readPhaseStatus(run, "phase-03")).toMatchObject({
      stop: { cause: "declared", status: "closed" },
    });
    expect(hold()).toBe(before);

    // phase-05 does not stop: the run ends past it.
    const last = await resumeHeldRun(run);
    if (Either.isLeft(last)) expect(last.left).not.toBeInstanceOf(AwaitingReviewStopError);
    expect(readPhaseStatus(run, "phase-05")).toMatchObject({ stop: null });
    expect(hold()).toBe(before);
  });

  it("keeps the hold byte-identical through a rate-limit pause and a declared phase", async () => {
    const HOLD_PHASE_04 = { selection: "listed", phases: ["phase-04"] } as const;
    const { run, result } = await startHeldRun(world, HOLD_PHASE_04, {
      prepare: (held) => held.backend.rateLimited.add("phase-02"),
    });
    const hold = (): string => JSON.stringify(readRunStatus(run)["hold"]);
    const before = hold();
    expect(JSON.parse(before)).toEqual(HOLD_PHASE_04);
    failedWith(result, RateLimitError);
    expect(readRunStatus(run)["state"]).toBe("rate_limited");
    expect(hold()).toBe(before);

    // phase-02 commits without stopping; the declared phase-03 stops.
    const declared = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);
    expect(declared.phase).toBe("phase-03");
    expect(declared.report.cause).toBe("declared");
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({ state: "cleaned_up", stop: null });
    expect(hold()).toBe(before);

    // phase-03 closes; phase-04 holds.
    const held04 = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);
    expect(held04.phase).toBe("phase-04");
    expect(held04.report.cause).toBe("held");
    expect(hold()).toBe(before);

    // phase-04 closes; phase-05 does not stop.
    const last = await resumeHeldRun(run);
    if (Either.isLeft(last)) expect(last.left).not.toBeInstanceOf(AwaitingReviewStopError);
    expect(readPhaseStatus(run, "phase-05")).toMatchObject({ stop: null });
    expect(hold()).toBe(before);
  });

  it("never stops a phase that is not held", async () => {
    const { run, result } = await startHeldRun(world, { selection: "none" });
    const error = failedWith(result, AwaitingReviewStopError);
    expect(error.phase).toBe("phase-03");
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({ stop: null });
    expect(backendCalls(run, "phase-02").map((c) => c.kind)).toEqual(["run", "resume"]);
  });
});

describe("later phases read the corrections", { timeout: 60_000 }, () => {
  it("puts the held and the declared corrections under Review corrections, and leaves the plan as approved", async () => {
    const { run } = await heldAtPhase02();
    const planBytes = (): string[] =>
      ["phax-plan.json", "plan.md"].map((f) => readFileSync(join(run.runPath, f), "utf8"));
    const plansBefore = planBytes();
    correct(run);

    // phase-02 closes; phase-03 (declared) stops, is corrected and closes.
    failedWith(await resumeHeldRun(run), AwaitingReviewStopError);
    expect(planBytes()).toEqual(plansBefore);
    writeFileSync(
      join(tree(run, "phase-03"), "src", "invoiceRow.ts"),
      "export const header = 'Invoice number (credit notes too)';\n",
    );
    await resumeHeldRun(run);

    const prompt = (phaseId: string): string => backendCalls(run, phaseId)[0]!.prompt;
    const phase04 = prompt("phase-04");
    expect(phase04).toContain("## Review corrections");
    expect(phase04).toContain("Where this section disagrees with an earlier phase's handoff");
    const held = phase04.indexOf("### phase-02 (held)");
    const declared = phase04.indexOf("### phase-03 (interactive)");
    expect(held).toBeGreaterThan(-1);
    expect(declared).toBeGreaterThan(held);
    // phase-02's correction handoff, not its builder handoff, sits under its heading.
    expect(
      readFileSync(join(phaseFolder(run), "correction-handoff.md"), "utf8").length,
    ).toBeGreaterThan(0);
    expect(phase04.slice(held, declared)).toContain(
      readFileSync(join(phaseFolder(run), "correction-handoff.md"), "utf8")
        .trimEnd()
        .split("\n")[0]!,
    );
    // The previous phase's handoff is the nearest headless phase's own: phase-02's
    // builder handoff, never its correction handoff nor phase-03's.
    const previous = phase04.slice(
      phase04.indexOf("## Previous phase handoff"),
      phase04.indexOf("## Review corrections"),
    );
    expect(previous).toContain(handoffOf("phase-02").trimEnd());
    expect(previous).not.toContain("What was corrected");
    // phase-05 and phase-06 read both stops as well.
    for (const later of ["phase-05", "phase-06"]) {
      const text = prompt(later);
      expect(text).toContain("### phase-02 (held)");
      expect(text).toContain("### phase-03 (interactive)");
    }
    // phase-04 keeps its approved section, and the plan files are untouched.
    expect(phase04).toContain("Write src/phase-04.ts.");
    expect(planBytes()).toEqual(plansBefore);
  });

  it("gives a run without a stop its prompts as before: no Review corrections", async () => {
    const { run, result } = await startHeldRun(world, { selection: "none" });
    failedWith(result, AwaitingReviewStopError);
    // phase-03's first turn is a first reading; no headless prompt so far has the section.
    for (const call of backendCalls(run)) {
      expect(call.prompt).not.toContain("## Review corrections");
    }
    expect(readRunStatus(run)["hold"]).toEqual({ selection: "none" });
  });
});

describe("reset at a held stop", { timeout: 60_000 }, () => {
  it("runs the phase again from phase-01's commit and holds it again", async () => {
    const { run } = await heldAtPhase02();
    const { loadConfig } = await import("../../src/app/loadConfig.js");
    vi.mocked(loadConfig).mockReturnValue(Either.right(run.config));
    const { runResetPhase } = await import("../../src/cli/commands/resetPhase.js");
    const out = {
      log: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as Parameters<typeof runResetPhase>[3];
    const phase01Tip = gitIn(world.repoRoot, "rev-parse", `phax/${SHORT}--phase-01`);

    expect(await runResetPhase(SHORT, "phase-02", { yes: true }, out)).toBe(0);

    const held = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);
    expect(held.report.cause).toBe("held");
    expect(held.phase).toBe("phase-02");
    const again = gitIn(world.repoRoot, "rev-parse", `phax/${SHORT}--phase-02`);
    expect(gitIn(world.repoRoot, "rev-parse", `${again}^`)).toBe(phase01Tip);
    expect(readJson(join(phaseFolder(run), "status.json"))).toMatchObject({
      state: "awaiting_review",
      commitHash: again,
      stop: { cause: "held", status: "waiting" },
    });
  });
});
