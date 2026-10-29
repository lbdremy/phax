import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AwaitingReviewStopError,
  CommitPausedError,
  HandoffPausedError,
} from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { protectedList } from "../../src/domain/security/protectedPaths.js";
import {
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

// The protected-paths check where the fix loop does not run (spec §5.12,
// §5.16, §5.18): a commit-only resume, the handoff turn and every resume out
// of a failed handoff, a held phase's hold-point re-entry, and a stop's close,
// which is never checked. The made-up invoice-export run holding phase-02, in
// a temporary repository whose phax.json protects `**/steme.baseline.json`.

vi.mock("../../src/app/loadRouting.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/loadRouting.js")>()),
  loadModelRouting: () => Effect.succeed(DEFAULT_MODEL_ROUTING),
  loadProviderConfig: () => Effect.succeed(DEFAULT_PROVIDER_CONFIG),
}));

const HOLD_PHASE_02 = { selection: "listed", phases: ["phase-02"] } as const;
const BASELINE = "packages/a/steme.baseline.json";
const GLOB = "**/steme.baseline.json";
const ORIGINAL = "{}\n";
const EDITED = '{"debt":["x"]}\n';
const RECORDS_BRANCH = "phax/records/v1";

let world: HeldWorld;

beforeEach(() => {
  world = createHeldWorld();
  vi.stubEnv("HOME", world.home);
  // The protected file is part of the base every phase starts from.
  mkdirSync(join(world.repoRoot, dirname(BASELINE)), { recursive: true });
  writeFileSync(join(world.repoRoot, BASELINE), ORIGINAL);
  gitIn(world.repoRoot, "add", "-A");
  gitIn(world.repoRoot, "commit", "-m", "chore: add the baseline");
});

afterEach(() => {
  vi.unstubAllEnvs();
  world.cleanup();
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Declare the project's protected list on the run's config (phax.json alone). */
const declare = (held: HeldRun): void => {
  Object.assign(held.config, { protectedPaths: protectedList([GLOB], "phax.json") });
};

function failedWith<E>(result: Either.Either<unknown, unknown>, type: new (...a: never[]) => E): E {
  if (Either.isRight(result)) throw new Error("the run did not pause");
  expect(result.left).toBeInstanceOf(type);
  return result.left as E;
}

const writeBaseline = (run: HeldRun, phaseId: string, content: string): void => {
  writeFileSync(join(worktreeOf(run, phaseId), BASELINE), content);
};

const putBackBaseline = (run: HeldRun, phaseId: string): void => {
  gitIn(worktreeOf(run, phaseId), "checkout", "--", BASELINE);
};

const commitsAhead = (run: HeldRun, phaseId: string): number =>
  Number(gitIn(worktreeOf(run, phaseId), "rev-list", "--count", "main..HEAD"));

const runStatus = (run: HeldRun): Record<string, unknown> => readRunStatus(run);

/** The files the records branch holds, or "" when the branch does not exist yet. */
function recordedFiles(): string {
  try {
    return gitIn(world.repoRoot, "log", "--name-only", "--format=", RECORDS_BRANCH);
  } catch {
    return "";
  }
}

function expectHeldStopAt(run: HeldRun, error: AwaitingReviewStopError, phaseId: string): void {
  expect(error.phase).toBe(phaseId);
  expect(existsSync(join(run.runPath, "review-stop.json"))).toBe(true);
}

// ── A commit-only resume ───────────────────────────────────────────────────

describe("a commit-only resume", { timeout: 60_000 }, () => {
  it("makes no commit for a protected change made since the pause, and pauses again as a failed commit", async () => {
    // A pre-commit hook rejects phase-01's commit: the phase pauses `passed`.
    const hooks = join(world.root, "hooks");
    mkdirSync(hooks);
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n", {
      mode: 0o755,
    });
    gitIn(world.repoRoot, "config", "--local", "core.hooksPath", hooks);

    const { run, result } = await startHeldRun(world, HOLD_PHASE_02, { prepare: declare });
    failedWith(result, CommitPausedError);
    expect(readPhaseStatus(run, "phase-01")["state"]).toBe("passed");
    expect(commitsAhead(run, "phase-01")).toBe(0);

    // The hook is fixed, and the person edits the protected file meanwhile.
    gitIn(world.repoRoot, "config", "--local", "--unset", "core.hooksPath");
    writeBaseline(run, "phase-01", EDITED);

    const error = failedWith(await resumeHeldRun(run), CommitPausedError);

    expect(error.message).toContain(`protected paths changed: ${BASELINE} (edited)`);
    expect(commitsAhead(run, "phase-01")).toBe(0);
    expect(readPhaseStatus(run, "phase-01")["state"]).toBe("passed");
    expect(runStatus(run)).toMatchObject({
      state: "interrupted",
      stoppedReason: "commit_failed",
    });
    expect(String(runStatus(run)["lastError"])).toContain(BASELINE);

    // Put back, the same resume commits and the run goes on to the hold.
    putBackBaseline(run, "phase-01");
    const stop = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);
    expectHeldStopAt(run, stop, "phase-02");
    expect(commitsAhead(run, "phase-01")).toBe(1);
  });
});

// ── The handoff turn ───────────────────────────────────────────────────────

describe("the handoff turn", { timeout: 60_000 }, () => {
  /** Phase-01's first handoff turn writes the protected file, as an agent's would. */
  const tamperDuringHandoff = (held: HeldRun): void => {
    declare(held);
    let tampered = false;
    held.backend.onHandoff = (phase) => {
      if (phase !== "phase-01" || tampered) return;
      tampered = true;
      writeBaseline(held, "phase-01", EDITED);
    };
  };

  it("pauses the phase as a failed handoff naming the path, with the commit at base content, no handoff copied and no phase record", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02, {
      records: true,
      prepare: tamperDuringHandoff,
    });

    const error = failedWith(result, HandoffPausedError);

    expect(error.message).toContain(BASELINE);
    // The phase commit holds the file at its phase-base content.
    expect(commitsAhead(run, "phase-01")).toBe(1);
    expect(gitIn(worktreeOf(run, "phase-01"), "show", `HEAD:${BASELINE}`)).toBe(ORIGINAL.trim());
    expect(gitIn(worktreeOf(run, "phase-01"), "status", "--porcelain")).toContain(BASELINE);
    // A failed handoff, not a done phase.
    expect(readPhaseStatus(run, "phase-01")["state"]).toBe("handoff_failed");
    expect(runStatus(run)).toMatchObject({ state: "interrupted" });
    expect(runStatus(run)).not.toHaveProperty("stoppedReason");
    expect(String(runStatus(run)["lastError"])).toBe(
      `Protected paths changed after the commit: ${BASELINE}`,
    );
    // The handoff is not copied, and no record is written.
    expect(existsSync(join(run.runPath, "phase-01", "phase-handoff.md"))).toBe(false);
    expect(recordedFiles()).not.toMatch(/phase-01/);
    // The resume instructions name the path and the two ways on.
    const instructions = readFileSync(join(run.runPath, "resume-instructions.md"), "utf8");
    expect(instructions).toContain(BASELINE);
    expect(instructions).toContain("phax resume");
    expect(instructions).toContain("start a new run");
    expect(instructions).not.toContain("reset-phase");
  });

  it("checks again after the new handoff turn of a resume out of the failed handoff", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02, {
      prepare: tamperDuringHandoff,
    });
    failedWith(result, HandoffPausedError);
    const turns = backendCalls(run, "phase-01").length;

    // The file is still changed: the new handoff turn leaves it so.
    const again = failedWith(await resumeHeldRun(run), HandoffPausedError);

    expect(again.message).toContain(BASELINE);
    expect(backendCalls(run, "phase-01")).toHaveLength(turns + 1);
    expect(readPhaseStatus(run, "phase-01")["state"]).toBe("handoff_failed");
    expect(existsSync(join(run.runPath, "phase-01", "phase-handoff.md"))).toBe(false);

    // Put back, the next resume validates the handoff and goes on to the hold.
    putBackBaseline(run, "phase-01");
    const stop = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);
    expectHeldStopAt(run, stop, "phase-02");
    expect(readFileSync(join(run.runPath, "phase-01", "phase-handoff.md"), "utf8")).toBe(
      handoffOf("phase-01"),
    );
  });
});

// ── A held phase's hold point ──────────────────────────────────────────────

describe("a held phase's hold-point re-entry", { timeout: 60_000 }, () => {
  it("pauses again as a failed handoff with no handoff turn and opens no stop", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02, {
      prepare: (held) => {
        declare(held);
        held.backend.brokenHandoffs.add("phase-02");
      },
    });
    failedWith(result, HandoffPausedError);
    expect(readPhaseStatus(run, "phase-02")["state"]).toBe("handoff_failed");
    // The handoff was validated and copied before the process died, and the
    // file was changed since.
    writeFileSync(join(run.runPath, "phase-02", "phase-handoff.md"), handoffOf("phase-02"));
    writeBaseline(run, "phase-02", EDITED);
    const calls = backendCalls(run).length;
    const commits = commitsAhead(run, "phase-02");

    const error = failedWith(await resumeHeldRun(run), HandoffPausedError);

    expect(error.message).toContain(BASELINE);
    expect(backendCalls(run)).toHaveLength(calls);
    expect(commitsAhead(run, "phase-02")).toBe(commits);
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "handoff_failed",
      stop: null,
    });
    expect(runStatus(run)).toMatchObject({ state: "interrupted" });
    expect(String(runStatus(run)["lastError"])).toContain(BASELINE);
    expect(existsSync(join(run.runPath, "review-stop.json"))).toBe(false);

    // Put back, the hold point opens its stop.
    putBackBaseline(run, "phase-02");
    const stop = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);
    expectHeldStopAt(run, stop, "phase-02");
    expect(stop.report.cause).toBe("held");
  });
});

// ── A stop's close ─────────────────────────────────────────────────────────

describe("a held stop's close", { timeout: 60_000 }, () => {
  it("passes its gate, commits a person's edit to a protected file and lists it under reviewCorrections", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02, { prepare: declare });
    failedWith(result, AwaitingReviewStopError);
    const c2 = gitIn(worktreeOf(run, "phase-02"), "rev-parse", "HEAD");

    // The person edits the protected file at the stop, with the test the
    // closing answer's guard names.
    writeBaseline(run, "phase-02", EDITED);
    mkdirSync(join(worktreeOf(run, "phase-02"), "tests"), { recursive: true });
    writeFileSync(
      join(worktreeOf(run, "phase-02"), "tests", "invoiceRow.test.ts"),
      "it('reads Invoice number', () => {});\n",
    );

    const next = failedWith(await resumeHeldRun(run), AwaitingReviewStopError);

    // The close was not blocked: the run went on to the declared phase-03.
    expect(next.report.cause).toBe("declared");
    expect(next.phase).toBe("phase-03");
    const status = readPhaseStatus(run, "phase-02");
    expect(status).toMatchObject({
      state: "cleaned_up",
      commitHash: c2,
      stop: { cause: "held", status: "closed", outcome: "corrected" },
    });
    // The review commit carries the change.
    const review = (status["stop"] as Record<string, unknown>)["reviewCommit"] as string;
    expect(gitIn(worktreeOf(run, "phase-02"), "show", `${review}:${BASELINE}`)).toBe(EDITED.trim());
    expect(
      gitIn(worktreeOf(run, "phase-02"), "show", "--name-only", "--format=", review).split("\n"),
    ).toContain(BASELINE);
    // A held stop reconciles its corrections in correction-reconciliation.json
    // (a declared stop's is file-reconciliation.json): the file is a review
    // correction, never a deviation.
    expect(readJson(join(run.runPath, "phase-02", "correction-reconciliation.json"))).toMatchObject(
      {
        reviewCorrections: [BASELINE, "tests/invoiceRow.test.ts"],
        unplannedCreated: [],
        unplannedEdited: [],
        hasDeviations: false,
      },
    );
  });
});
