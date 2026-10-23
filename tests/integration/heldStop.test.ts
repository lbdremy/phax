import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderStop } from "../../src/cli/commands/stopOutput.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { AwaitingReviewStopError, type HeldStopReport } from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { decodeReviewStopFile } from "../../src/schemas/reviewStop.js";
import {
  backendCalls,
  createHeldWorld,
  gitIn,
  handoffOf,
  readJson,
  readPhaseStatus,
  readRunStatus,
  RUN_KEY,
  SHORT,
  startHeldRun,
  worktreeOf,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";

// The made-up invoice-export run holding phase-02 (`--hold phase-02`): it
// commits phase-01, commits phase-02 and validates its handoff, then stops
// awaiting review with cause `held`, before phase-02's cleanup, with no agent
// turn after the commit.

vi.mock("../../src/app/loadRouting.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/loadRouting.js")>()),
  loadModelRouting: () => Effect.succeed(DEFAULT_MODEL_ROUTING),
  loadProviderConfig: () => Effect.succeed(DEFAULT_PROVIDER_CONFIG),
}));

const HOLD_PHASE_02 = { selection: "listed", phases: ["phase-02"] } as const;
const SCHEMA_URL = (format: string) =>
  new RegExp(`/${format}/\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.]+)?\\.json$`);

let world: HeldWorld;

beforeEach(() => {
  world = createHeldWorld();
  vi.stubEnv("HOME", world.home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  world.cleanup();
});

function heldStop(result: Either.Either<unknown, unknown>): {
  error: AwaitingReviewStopError;
  report: HeldStopReport;
} {
  if (Either.isRight(result)) throw new Error("the run did not stop");
  expect(result.left).toBeInstanceOf(AwaitingReviewStopError);
  const error = result.left as AwaitingReviewStopError;
  if (error.report.cause !== "held") throw new Error("the run stopped, but not held");
  return { error, report: error.report };
}

const phaseCommitOf = (run: HeldRun, phaseId: string): string =>
  readPhaseStatus(run, phaseId)["commitHash"] as string;

describe("a run holding phase-02", { timeout: 30_000 }, () => {
  it("commits phase-01 and phase-02, then stops at phase-02 before its cleanup", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02);
    const { error, report } = heldStop(result);

    // phase-01 ran to its cleanup.
    expect(readPhaseStatus(run, "phase-01")["state"]).toBe("cleaned_up");
    expect(existsSync(join(worktreeOf(run, "phase-01"), ".cleanup-marker"))).toBe(true);

    // phase-02 committed C2 with its validated handoff, and stays there.
    const c2 = phaseCommitOf(run, "phase-02");
    expect(c2).toMatch(/^[0-9a-f]{40}$/);
    const tree = worktreeOf(run, "phase-02");
    expect(gitIn(tree, "rev-parse", "HEAD")).toBe(c2);
    expect(gitIn(tree, "status", "--porcelain")).toBe("");
    expect(existsSync(join(tree, ".cleanup-marker"))).toBe(false);
    expect(readFileSync(join(run.runPath, "phase-02", "phase-handoff.md"), "utf8")).toBe(
      handoffOf("phase-02"),
    );

    // phase-02's backend calls: its work and its handoff, nothing after.
    expect(backendCalls(run, "phase-02").map((c) => [c.kind, c.options.readOnly === true])).toEqual(
      [
        ["run", false],
        ["resume", false],
      ],
    );

    // phase-03 has not started.
    expect(existsSync(worktreeOf(run, "phase-03"))).toBe(false);
    expect(existsSync(join(run.runPath, "phase-03"))).toBe(false);
    expect(gitIn(world.repoRoot, "branch", "--list", `phax/${SHORT}--phase-03`)).toBe("");

    // Run and phase await review with cause held; the builder session X0 is current.
    expect(readRunStatus(run)["state"]).toBe("awaiting_review");
    expect(readPhaseStatus(run, "phase-02")).toMatchObject({
      state: "awaiting_review",
      mode: "headless",
      commitHash: c2,
      stop: { cause: "held", status: "waiting" },
    });
    const session = readJson(join(run.runPath, "phase-02", "interactive-session.json"));
    expect(session["$schema"]).toMatch(SCHEMA_URL("interactive-session"));
    expect(session).toMatchObject({
      phaseId: "phase-02",
      provider: "codex-cli",
      interactiveResume: "verified",
      current: {
        provider: "codex-cli",
        model: "gpt-6-luna",
        effort: "medium",
        sessionId: "X0",
        origin: "builder",
        startedAt: readPhaseStatus(run, "phase-02")["createdAt"],
      },
      history: [],
      firstTurns: [],
      turnInProgress: null,
    });
    expect(existsSync(join(run.runPath, "resume-instructions.md"))).toBe(true);
    expect(run.lock.impl.statuses.get(RUN_KEY)).toEqual({ kind: "none" });

    // phax run: exit 13 and the held stop printed.
    expect(exitCodeForError(error)).toBe(13);
    const reviewStopPath = join(run.runPath, "review-stop.json");
    expect(report.reviewStopPath).toBe(reviewStopPath);
    const lines = renderStop(report);
    expect(lines[0]).toBe("◐ phase-02  Invoice CSV record — awaiting review (held: --hold)");
    expect(lines).toContain(`  Phase commit: ${c2.slice(0, 7)} feat(export): invoice csv record`);
    expect(lines).toContain(`  Handoff:   ${join(run.runPath, "phase-02", "phase-handoff.md")}`);
    expect(lines).toContain(`  Worktree:  ${tree}`);
    expect(lines).toContain(`  Seed:      ${join(tree, ".phax-context", "interactive-review.md")}`);
    expect(lines).toContain("  Continue the session that built phase-02:");
    expect(lines.some((l) => l.includes("'codex' 'resume' 'X0'"))).toBe(true);
    expect(lines.some((l) => l.includes("trust the directory"))).toBe(true);
    expect(lines).toContain(
      `    or: phax enter-phase ${SHORT} phase-02   (add --new-session for a fresh read-only look)`,
    );
    expect(lines).toContain(`    phax resume ${SHORT}`);
    expect(lines).toContain(`  Stop: ${reviewStopPath}`);
  });

  it("writes review-stop.json's held variant, naming C2 and continuing X0", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02);
    heldStop(result);
    const raw = readJson(join(run.runPath, "review-stop.json"));

    expect(raw["$schema"]).toMatch(SCHEMA_URL("review-stop"));
    expect(raw).not.toHaveProperty("firstReading");
    const decoded = decodeReviewStopFile(raw);
    if (Either.isLeft(decoded)) throw new Error(String(decoded.left));
    const stop = decoded.right;
    if (stop.cause !== "held") throw new Error("not the held variant");
    expect(stop).toMatchObject({
      run: SHORT,
      state: "awaiting_review",
      phase: { id: "phase-02", title: "Invoice CSV record", mode: "headless", position: 2, of: 6 },
      phaseCommit: phaseCommitOf(run, "phase-02"),
      worktree: worktreeOf(run, "phase-02"),
      session: { provider: "codex-cli", sessionId: "X0", origin: "builder" },
      lastClose: null,
      closeBase: null,
    });
    expect(stop.commands.continue?.argv.slice(0, 3)).toEqual(["codex", "resume", "X0"]);
    expect(stop.commands.close.argv).toEqual(["phax", "resume", SHORT]);
  });

  it("writes the held seed twice, holding all the person needs", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02);
    heldStop(result);
    const inWorktree = readFileSync(
      join(worktreeOf(run, "phase-02"), ".phax-context", "interactive-review.md"),
      "utf8",
    );
    const inRunFolder = readFileSync(join(run.runPath, "phase-02", "review-seed.md"), "utf8");
    expect(inWorktree).toBe(inRunFolder);

    const c2 = phaseCommitOf(run, "phase-02");
    const base = readPhaseStatus(run, "phase-02")["base"] as string;
    expect(base).toBe(phaseCommitOf(run, "phase-01"));
    expect(inWorktree).toContain(`# Held for review: phase-02 of ${SHORT}`);
    expect(inWorktree).toContain(`(${c2.slice(0, 7)}, on ${base.slice(0, 7)})`);
    expect(inWorktree).toContain("## The phase (plan, phase-02)\n## phase-02 — Invoice CSV record");
    expect(inWorktree).toContain(`## What it delivered (its handoff)\n${handoffOf("phase-02")}`);
    expect(inWorktree).toContain(
      readFileSync(join(run.runPath, "phase-02", "file-reconciliation.md"), "utf8").trimEnd(),
    );
    expect(inWorktree).toContain(
      `### phase-01 — Export port — handoff\n${handoffOf("phase-01").trimEnd()}`,
    );
    for (const later of ["phase-03", "phase-04", "phase-05", "phase-06"]) {
      expect(inWorktree).toContain(`### ${later} — `);
    }
    expect(inWorktree).toContain("## Gate\npnpm typecheck\n");
    expect(inWorktree).toContain(`  phax resume ${SHORT}\n`);
  });

  it("records no current session and prints the fresh start when the builder left no session id", async () => {
    const { run, result } = await startHeldRun(world, HOLD_PHASE_02, {
      prepare: (held) => {
        // The binding names no session once phase-02's handoff turn has run.
        held.backend.onHandoff = (phase, folder) => {
          if (phase !== "phase-02" || folder === undefined) return;
          const path = join(folder, "agent-binding.json");
          writeFileSync(path, JSON.stringify({ ...readJson(path), sessionId: null }, null, 2));
        };
      },
    });
    const { report } = heldStop(result);

    const session = readJson(join(run.runPath, "phase-02", "interactive-session.json"));
    expect(session["current"]).toBeNull();
    expect(report.reviewStop.session).toBeNull();
    expect(report.reviewStop.commands.continue).toBeNull();
    const lines = renderStop(report);
    expect(lines).toContain("  Start a session:");
    expect(lines.some((l) => l.includes("'codex' '-m'"))).toBe(true);
    expect(lines.some((l) => l.includes("'resume'"))).toBe(false);
  });

  it("never reads stdin, with no terminal and an idle stdin pipe", async () => {
    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const read = vi.spyOn(process.stdin, "read");
    const on = vi.spyOn(process.stdin, "on");
    const resumed = vi.spyOn(process.stdin, "resume");
    try {
      const { result } = await startHeldRun(world, HOLD_PHASE_02);
      expect(exitCodeForError(heldStop(result).error)).toBe(13);
      expect(read).not.toHaveBeenCalled();
      expect(on).not.toHaveBeenCalled();
      expect(resumed).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      on.mockRestore();
      resumed.mockRestore();
      Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
    }
  });
});
