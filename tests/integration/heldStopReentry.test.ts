import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { syncSaveInterruptedRun } from "../../src/cli/interruptHandler.js";
import {
  AwaitingReviewStopError,
  HandoffPausedError,
  HeldCloseUnavailableError,
  HoldPointPausedError,
} from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import {
  backendCalls,
  createHeldWorld,
  gitIn,
  handoffOf,
  NAMESPACE,
  readJson,
  readPhaseStatus,
  readRunStatus,
  resumeHeldRun,
  SHORT,
  startHeldRun,
  worktreeOf,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";

// The made-up invoice-export run holding phase-02, re-entering its hold point:
// after a handoff pause, after an interruption or a failure before the stop,
// and the interim refusal of a resume at a held stop no phax can close yet.

vi.mock("../../src/app/loadRouting.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/loadRouting.js")>()),
  loadModelRouting: () => Effect.succeed(DEFAULT_MODEL_ROUTING),
  loadProviderConfig: () => Effect.succeed(DEFAULT_PROVIDER_CONFIG),
}));

const HOLD_PHASE_02 = { selection: "listed", phases: ["phase-02"] } as const;

let world: HeldWorld;

beforeEach(() => {
  world = createHeldWorld();
  vi.stubEnv("HOME", world.home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  world.cleanup();
});

function failedWith<E>(result: Either.Either<unknown, unknown>, type: new (...a: never[]) => E): E {
  if (Either.isRight(result)) throw new Error("the run did not stop");
  expect(result.left).toBeInstanceOf(type);
  return result.left as E;
}

function expectHeldStop(run: HeldRun, result: Either.Either<unknown, unknown>): void {
  const error = failedWith(result, AwaitingReviewStopError);
  expect(error.report.cause).toBe("held");
  expect(error.phase).toBe("phase-02");
  expect(readRunStatus(run)["state"]).toBe("awaiting_review");
  expect(readPhaseStatus(run, "phase-02")).toMatchObject({
    state: "awaiting_review",
    stop: { cause: "held", status: "waiting" },
  });
  expect(existsSync(join(run.runPath, "review-stop.json"))).toBe(true);
}

const seedCopy = (run: HeldRun): string => join(run.runPath, "phase-02", "review-seed.md");

const tipOf = (run: HeldRun): string => gitIn(worktreeOf(run, "phase-02"), "rev-parse", "HEAD");
const commitsOn = (run: HeldRun): string =>
  gitIn(worktreeOf(run, "phase-02"), "rev-list", "--count", "HEAD");
const gateCallsIn = (run: HeldRun, phaseId: string) =>
  run.shellCalls.filter((c) => c.cwd === worktreeOf(run, phaseId));

function patchJson(path: string, patch: (value: Record<string, unknown>) => void): void {
  const value = readJson(path);
  patch(value);
  writeFileSync(path, JSON.stringify(value, null, 2));
}

// The disk a process killed inside phase-02's hold point leaves: the phase
// committed with no stop, none of the stop's files, the run still running.
function rewindToTheHoldPoint(run: HeldRun): void {
  patchJson(join(run.runPath, "run-status.json"), (status) => {
    status["state"] = "running";
    delete status["stoppedReason"];
  });
  patchJson(join(run.runPath, "phase-02", "status.json"), (status) => {
    status["state"] = "committed";
    status["stop"] = null;
  });
  for (const file of [
    join(run.runPath, "review-stop.json"),
    join(run.runPath, "resume-instructions.md"),
    join(run.runPath, "phase-02", "interactive-session.json"),
    join(run.runPath, "phase-02", "review-seed.md"),
    join(worktreeOf(run, "phase-02"), ".phax-context", "interactive-review.md"),
  ]) {
    rmSync(file, { force: true });
  }
}

describe("re-entering a hold point", { timeout: 30_000 }, () => {
  it("stops once a resume validates the handoff of a held phase that paused on it", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02, {
      prepare: (held) => held.backend.brokenHandoffs.add("phase-02"),
    });
    failedWith(result, HandoffPausedError);
    expect(readPhaseStatus(run, "phase-02")["state"]).toBe("handoff_failed");
    const c2 = readPhaseStatus(run, "phase-02")["commitHash"];
    const commits = commitsOn(run);

    expectHeldStop(run, await resumeHeldRun(run));

    expect(tipOf(run)).toBe(c2);
    expect(commitsOn(run)).toBe(commits);
    expect(readFileSync(join(run.runPath, "phase-02", "phase-handoff.md"), "utf8")).toBe(
      handoffOf("phase-02"),
    );
    // Its work, the broken handoff, then the resumed handoff: no other turn.
    expect(backendCalls(run, "phase-02").map((c) => c.kind)).toEqual(["run", "resume", "resume"]);
  });

  it("stops on resume after an interruption before the stop, with no turn, gate or commit", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02);
    failedWith(result, AwaitingReviewStopError);
    const c2 = tipOf(run);
    rewindToTheHoldPoint(run);
    expect(
      syncSaveInterruptedRun({
        namespace: NAMESPACE,
        shortName: SHORT,
        stateRoot: world.stateRoot,
      }),
    ).toEqual({
      state: "interrupted",
      stopPhaseId: null,
    });
    const callsBefore = backendCalls(run).length;
    const gatesBefore = gateCallsIn(run, "phase-02").length;

    expectHeldStop(run, await resumeHeldRun(run));

    expect(backendCalls(run)).toHaveLength(callsBefore);
    expect(gateCallsIn(run, "phase-02")).toHaveLength(gatesBefore);
    expect(tipOf(run)).toBe(c2);
    expect(readJson(join(run.runPath, "phase-02", "interactive-session.json"))).toMatchObject({
      current: { sessionId: "X0", origin: "builder" },
    });
    expect(existsSync(join(run.runPath, "phase-02", "review-seed.md"))).toBe(true);
  });

  it("re-enters the hold point of a handoff_failed phase whose copied handoff is valid, with no handoff turn", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02, {
      prepare: (held) => held.backend.brokenHandoffs.add("phase-02"),
    });
    failedWith(result, HandoffPausedError);
    // The handoff was validated and copied before the process died.
    writeFileSync(join(run.runPath, "phase-02", "phase-handoff.md"), handoffOf("phase-02"));
    const callsBefore = backendCalls(run).length;

    expectHeldStop(run, await resumeHeldRun(run));

    expect(backendCalls(run)).toHaveLength(callsBefore);
  });

  it("pauses without a record or RunFailed when the seed cannot be written, and stops on a later resume", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02, {
      records: true,
      prepare: (held) => {
        held.backend.onHandoff = (phase) => {
          // A directory where the seed's run-folder copy goes: its write fails.
          if (phase === "phase-02") mkdirSync(seedCopy(held), { recursive: true });
        };
      },
    });
    const error = failedWith(result, HoldPointPausedError);
    expect(exitCodeForError(error)).toBe(1);

    expect(readRunStatus(run)).toMatchObject({
      state: "interrupted",
      stoppedReason: "hold_point_failed",
    });
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({ state: "committed", stop: null });
    expect(existsSync(join(run.runPath, "review-stop.json"))).toBe(false);
    expect(readFileSync(join(run.runPath, "resume-instructions.md"), "utf8")).toContain(
      `phax resume ${SHORT}`,
    );
    const recorded = gitIn(world.repoRoot, "log", "--name-only", "--format=", "phax/records/v1");
    expect(recorded).toMatch(/phase-01\/record\.json/);
    expect(recorded).not.toMatch(/phase-02/);

    rmSync(seedCopy(run), { recursive: true });
    expectHeldStop(run, await resumeHeldRun(run));
    expect(gitIn(world.repoRoot, "log", "--name-only", "--format=", "phax/records/v1")).not.toMatch(
      /phase-02/,
    );
  });

  it("refuses to resume a held stop before the close exists, changing nothing", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02);
    failedWith(result, AwaitingReviewStopError);
    const runBefore = readFileSync(join(run.runPath, "run-status.json"), "utf8");
    const phaseBefore = readFileSync(join(run.runPath, "phase-02", "status.json"), "utf8");
    const stopBefore = readFileSync(join(run.runPath, "review-stop.json"), "utf8");

    const error = failedWith(await resumeHeldRun(run), HeldCloseUnavailableError);

    expect(error.message).toContain("this phax cannot close a held stop yet");
    expect(exitCodeForError(error)).toBe(1);
    expect(readFileSync(join(run.runPath, "run-status.json"), "utf8")).toBe(runBefore);
    expect(readFileSync(join(run.runPath, "phase-02", "status.json"), "utf8")).toBe(phaseBefore);
    expect(readFileSync(join(run.runPath, "review-stop.json"), "utf8")).toBe(stopBefore);
    expect(existsSync(join(run.runPath, "phase-02", "review-stop.closing.json"))).toBe(false);
  });

  it("holds only the recorded phases: a run that holds none runs past phase-02", async () => {
    const { run, result } = await startHeldRun(world, { selection: "none" });
    // phase-03 is declared interactive: the run stops there instead.
    const error = failedWith(result, AwaitingReviewStopError);
    expect(error.report.cause).toBe("declared");
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({ state: "cleaned_up", stop: null });
  });
});
