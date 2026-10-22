import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Either } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composePhaxState } from "../../src/app/phaxState.js";
import { syncSaveInterruptedRun } from "../../src/cli/interruptHandler.js";
import type { PhaseId, RunId } from "../../src/domain/branded.js";
import { interpret } from "../../src/domain/reducer.js";
import {
  readReviewStopFile,
  readRunStatusFile,
  withSchemaUrl,
} from "../../src/schemas/persisted.js";
import { encodeReviewStopFile } from "../../src/schemas/reviewStop.js";
import type { PhaseStatus, RunStatus } from "../../src/schemas/status.js";
import { phaseStatus, reviewStop } from "../helpers/phaseStatusFixture.js";
import { removeTempDir } from "../helpers/tempGit.js";

// A SIGINT while `phax resume` closes the made-up invoice-export run's stop at
// phase-03: the handler's synchronous write is the reducer's verdict for
// RunInterruptRequested, and review-stop.json comes back from its parked copy.

const NAMESPACE = "example";
const SHORT = "invoice-export";
const CLOSE_BASE = "5d6e7f8a9b0c1d2e3f405162738495a6b7c8d9e0";

let root: string;
let runPath: string;
let phaseFolder: string;

const ctx = () => ({ namespace: NAMESPACE, shortName: SHORT, stateRoot: root });

function runStatus(state: RunStatus["state"]): RunStatus {
  return {
    namespace: NAMESPACE,
    shortName: SHORT,
    runId: "invoice-export-1792667922832",
    state,
    createdAt: "2026-10-22T09:00:00.000Z",
    updatedAt: "2026-10-22T09:00:00.000Z",
    phasesCount: 4,
    currentPhaseIndex: 2,
    lastError: "Close of the stop refused: gate-failed (exit 4)",
  } as RunStatus;
}

function phase03(state: PhaseStatus["state"]): PhaseStatus {
  return phaseStatus({
    phaseId: "phase-03",
    phaseIndex: 2,
    state,
    model: "claude-sonnet-5-5",
    effort: "medium",
    branchName: "phax/invoice-export--phase-03",
    base: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
    worktreePath: "/example/worktrees/invoice-export/phase-03",
    createdAt: "2026-10-22T09:00:00.000Z",
    updatedAt: "2026-10-22T09:00:00.000Z",
    mode: "interactive",
    stop: state === "awaiting_review" ? { cause: "declared", status: "waiting" } : null,
  });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const stopPath = () => join(runPath, "review-stop.json");
const parkedPath = () => join(phaseFolder, "review-stop.closing.json");

function seed(run: RunStatus, phase: PhaseStatus, parked: boolean): void {
  writeJson(join(runPath, "run-status.json"), withSchemaUrl("run-status", run));
  writeJson(join(phaseFolder, "status.json"), withSchemaUrl("phase-status", phase));
  const stop = encodeReviewStopFile(
    withSchemaUrl("review-stop", reviewStop({ closeBase: CLOSE_BASE })),
  );
  writeJson(parked ? parkedPath() : stopPath(), stop);
}

function savedRunStatus(): RunStatus {
  const path = join(runPath, "run-status.json");
  return Either.getOrThrow(readRunStatusFile(path, readJson(path)));
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "phax-interrupt-close-test-")));
  runPath = join(root, "runs", `${NAMESPACE}.${SHORT}`);
  phaseFolder = join(runPath, "phase-03");
  mkdirSync(phaseFolder, { recursive: true });
});

afterEach(() => {
  removeTempDir(root);
});

describe("an interrupt while a close runs", () => {
  it("writes the reducer's verdict: the run back at awaiting_review", () => {
    const run = runStatus("running");
    const phase = phase03("awaiting_review");
    seed(run, phase, true);
    const verdict = interpret(composePhaxState(run.state, run.lastError, phase), {
      type: "RunInterruptRequested",
      eventId: "e1",
      occurredAt: "2026-10-22T10:00:00.000Z",
      run: SHORT as unknown as RunId,
      phase: "phase-03" as PhaseId,
    });
    expect(verdict.kind).toBe("Handled");
    if (verdict.kind !== "Handled") return;

    const saved = syncSaveInterruptedRun(ctx());

    expect(saved).toEqual({ state: "awaiting_review", stopPhaseId: "phase-03" });
    const after = savedRunStatus();
    expect(after.state).toBe(verdict.nextState.run);
    expect(after.state).toBe("awaiting_review");
    // The reducer records no lastError for an interruption: it stays as it was.
    expect(after.lastError).toBe(run.lastError);
  });

  it("moves the parked review-stop.json back with lastClose interrupted, keeping closeBase", () => {
    seed(runStatus("running"), phase03("awaiting_review"), true);

    syncSaveInterruptedRun(ctx());

    expect(existsSync(parkedPath())).toBe(false);
    const restored = Either.getOrThrow(readReviewStopFile(stopPath(), readJson(stopPath())));
    expect(restored.lastClose).toMatchObject({ result: "interrupted", exitCode: 130 });
    expect(restored.closeBase).toBe(CLOSE_BASE);
    const { lastClose: _lastClose, ...rest } = restored;
    const { lastClose: _none, ...before } = reviewStop({ closeBase: CLOSE_BASE });
    expect(rest).toEqual(before);
  });

  it("restores a review stop the close never parked", () => {
    seed(runStatus("running"), phase03("awaiting_review"), false);

    syncSaveInterruptedRun(ctx());

    const restored = Either.getOrThrow(readReviewStopFile(stopPath(), readJson(stopPath())));
    expect(restored.lastClose).toMatchObject({ result: "interrupted", exitCode: 130 });
  });
});

describe("an interrupt while a close runs with no review stop to restore", () => {
  it("saves the run as interrupted, not awaiting a review it has no document for", () => {
    writeJson(join(runPath, "run-status.json"), withSchemaUrl("run-status", runStatus("running")));
    writeJson(
      join(phaseFolder, "status.json"),
      withSchemaUrl("phase-status", phase03("awaiting_review")),
    );

    expect(syncSaveInterruptedRun(ctx())).toEqual({ state: "interrupted", stopPhaseId: null });
    expect(savedRunStatus().state).toBe("interrupted");
    expect(existsSync(stopPath())).toBe(false);
  });

  it("leaves an unreadable parked copy in place and saves the run as interrupted", () => {
    seed(runStatus("running"), phase03("awaiting_review"), true);
    writeFileSync(parkedPath(), JSON.stringify({ $schema: "made-up" }));

    expect(syncSaveInterruptedRun(ctx())).toEqual({ state: "interrupted", stopPhaseId: null });
    expect(savedRunStatus().state).toBe("interrupted");
    expect(existsSync(parkedPath())).toBe(true);
    expect(existsSync(stopPath())).toBe(false);
  });
});

describe("an interrupt away from a close", () => {
  it("interrupts a running phase as before and leaves no review stop", () => {
    writeJson(join(runPath, "run-status.json"), withSchemaUrl("run-status", runStatus("running")));
    writeJson(join(phaseFolder, "status.json"), withSchemaUrl("phase-status", phase03("running")));

    expect(syncSaveInterruptedRun(ctx())).toEqual({ state: "interrupted", stopPhaseId: null });
    expect(savedRunStatus().state).toBe("interrupted");
    expect(existsSync(stopPath())).toBe(false);
  });

  it("leaves a run already awaiting review untouched", () => {
    seed(runStatus("awaiting_review"), phase03("awaiting_review"), false);
    const before = readFileSync(stopPath(), "utf8");

    expect(syncSaveInterruptedRun(ctx())).toBeNull();
    expect(savedRunStatus().state).toBe("awaiting_review");
    expect(readFileSync(stopPath(), "utf8")).toBe(before);
  });
});
