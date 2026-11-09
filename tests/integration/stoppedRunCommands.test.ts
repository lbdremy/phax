import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Result, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archive } from "../../src/app/archive.js";
import type { ShortName } from "../../src/domain/branded.js";
import { ArchiveRefusedError } from "../../src/domain/errors.js";
import { makeFakeEditor } from "../../src/infra/fakes/editor.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { makeFakeSession } from "../../src/infra/fakes/session.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  NAMESPACE,
  createWorld,
  patchJson,
  readJson,
  resolvedConfig,
  stopRun,
  writeRegistry,
  type StoppedRun,
  type World,
} from "../helpers/stoppedRunFixture.js";
import { phaxCall } from "../helpers/runnerCall.js";

// The commands that act on a run waiting at a declared stop: the made-up
// invoice-export run stopped at phase-03 by the real stop, beside credit-notes
// and payments-fix. A fake session, a fake shell (a script that records its
// cwd) and a fake editor record what would be started.

const fakes = vi.hoisted(() => ({
  session: undefined as unknown as { layer: unknown },
  editor: undefined as unknown as { layer: unknown },
}));

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/infra/session.js", () => ({
  makeNodeSessionLayer: () => fakes.session.layer,
}));
vi.mock("../../src/infra/editor.js", () => ({
  makeNodeEditorLayer: () => fakes.editor.layer,
}));
// No test reads ~/.phax: providers.json is the built-in catalog.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const { Effect: E } = await import("effect");
  const { DEFAULT_PROVIDER_CONFIG: defaults } =
    await import("../../src/domain/routing/defaults.js");
  return { ...original, loadProviderConfig: () => E.succeed(defaults) };
});
// The journal would write under ~/.phax: telemetry is off in these tests.
vi.mock("../../src/cli/commands/runLayers.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/cli/commands/runLayers.js")>();
  const { NoopSystemTelemetryLayer: noop } = await import("../../src/ports/systemTelemetry.js");
  return { ...original, makeGlobalTelemetryJournalLayerOrNoop: () => noop };
});

let world: World;
let fakeSession: ReturnType<typeof makeFakeSession>;
let fakeEditor: ReturnType<typeof makeFakeEditor>;

beforeEach(async () => {
  world = createWorld();
  fakeSession = makeFakeSession();
  fakeEditor = makeFakeEditor();
  fakes.session = fakeSession as unknown as { layer: unknown };
  fakes.editor = fakeEditor as unknown as { layer: unknown };
  const { loadConfig } = await import("../../src/app/loadConfig.js");
  vi.mocked(loadConfig).mockReturnValue(Result.succeed(resolvedConfig(world)));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  world.cleanup();
});

const statePath = (run: StoppedRun) => join(run.runPath, "run-status.json");
const stopPath = (run: StoppedRun) => join(run.runPath, "review-stop.json");

describe("phax ls and phax session-info on a waiting run", () => {
  async function threeRuns() {
    const waiting = await stopRun(world, { shortName: "invoice-export" });
    const failed = await stopRun(world, { shortName: "credit-notes" });
    const interrupted = await stopRun(world, { shortName: "payments-fix" });
    patchJson(statePath(failed), { state: "failed", lastError: "gate failed" });
    patchJson(statePath(interrupted), { state: "interrupted" });
    writeRegistry(world, [waiting, failed, interrupted]);
    return { waiting, failed, interrupted };
  }

  it("lists the waiting run as awaiting_review (declared) with its stopped phase", async () => {
    await threeRuns();
    const { code, outLines: logs } = await phaxCall(["ls"]);

    expect(code).toBe(0);

    const table = logs.join("\n");
    const waitingRow = table.split("\n").find((l) => l.includes("example.invoice-export"))!;
    expect(waitingRow).toContain("awaiting_review (declared)");
    expect(waitingRow).toContain("3/4 phase-03");
    for (const name of ["credit-notes", "payments-fix"]) {
      const row = table.split("\n").find((l) => l.includes(name))!;
      expect(row).not.toContain("awaiting_review");
      expect(row).not.toContain("phase-03");
    }
    expect(table.split("\n").find((l) => l.includes("credit-notes"))).toContain("failed");
    expect(table.split("\n").find((l) => l.includes("payments-fix"))).toContain("interrupted");
  });

  it("lists the waiting run alone with --awaiting-review", async () => {
    await threeRuns();
    const { code, outLines: logs } = await phaxCall(["ls", "--awaiting-review"]);

    expect(code).toBe(0);

    const rows = logs.join("\n").split("\n").slice(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("example.invoice-export");
    expect(rows[0]).toContain("awaiting_review (declared)");
  });

  it("prints the waiting run's stop in ls --json, the review-stop document as the file holds it", async () => {
    const { waiting } = await threeRuns();
    const { code, outLines: logs } = await phaxCall(["ls", "--json", "--awaiting-review"]);

    expect(code).toBe(0);

    const rows = (JSON.parse(logs.join("\n")) as { runs: Record<string, unknown>[] }).runs;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "awaiting_review", currentPhase: "3/4" });
    expect(rows[0]!["stop"]).toEqual(readJson(stopPath(waiting)));
  });

  it("session-info prints the state, cause, stopped phase, worktree, seed and session", async () => {
    const run = await stopRun(world);
    const { code, outLines: logs } = await phaxCall(["session-info", run.shortName]);

    expect(code).toBe(0);

    const text = logs.join("\n");
    expect(text).toContain("Status:           awaiting_review (declared)");
    expect(text).toContain(
      "Stopped phase:    phase-03 — Review the export record (interactive, 3/4)",
    );
    expect(text).toContain(`Worktree:         ${run.worktree}`);
    expect(text).toContain(
      `Seed:             ${join(run.worktree, ".phax-context", "interactive-review.md")}`,
    );
    expect(text).toContain(
      "Session:          claude-code X1 (first-turn; continue: phax enter-phase invoice-export phase-03)",
    );
    expect(text).toContain("Suggested enter:  phax enter-phase example.invoice-export phase-03");
  });

  it("session-info prints the session as none when the first turn failed", async () => {
    const run = await stopRun(world, { sessionId: undefined });
    const { code, outLines: logs } = await phaxCall(["session-info", run.shortName]);

    expect(code).toBe(0);

    expect(logs.join("\n")).toContain("Session:          none");
  });
});

describe("phax path, shell and open on a waiting run", () => {
  it("target the stopped phase's worktree", async () => {
    const run = await stopRun(world);
    // `shell` hands $SHELL to the Session port, which this file replaces with the fake session.
    const script = join(world.root, "fake-shell.sh");
    vi.stubEnv("SHELL", script);

    const pathCall = await phaxCall(["path", run.shortName]);
    expect(pathCall.code).toBe(0);
    expect(pathCall.outLines).toEqual([run.worktree]);

    expect((await phaxCall(["shell", run.shortName])).code).toBe(0);
    expect(fakeSession.impl.invocations).toEqual([
      { executable: script, args: [], cwd: run.worktree, env: {} },
    ]);

    expect((await phaxCall(["open", run.shortName])).code).toBe(0);
    expect(fakeEditor.impl.openCalls).toEqual([run.worktree]);
  });
});

// Three uncommitted corrections: one modified, one added, one deleted file.
function makeCorrections(run: StoppedRun): void {
  writeFileSync(
    join(run.worktree, "src", "invoiceRow.ts"),
    "export const header = 'Invoice number';\n",
  );
  writeFileSync(join(run.worktree, "src", "creditNote.ts"), "export const credit = true;\n");
  rmSync(join(run.worktree, "docs", "notes.md"));
}

describe("phax reset-phase on a waiting run", () => {
  it("previews the three uncommitted corrections and changes nothing without --yes", async () => {
    const run = await stopRun(world);
    makeCorrections(run);

    const call = await phaxCall(["reset-phase", run.shortName, "phase-03"]);
    expect(call.code).toBe(0);

    const text = call.outLines.join("\n");
    expect(text).toContain("3 uncommitted correction(s)");
    expect(text).toContain("  D docs/notes.md");
    expect(text).toContain("  A src/creditNote.ts");
    expect(text).toContain("  M src/invoiceRow.ts");
    expect(text).toContain(
      "phax resume example.invoice-export will set the phase up again and stop there.",
    );
    expect(call.err).toBe("");
    expect(existsSync(stopPath(run))).toBe(true);
    expect(existsSync(run.worktree)).toBe(true);
    expect(readJson(statePath(run))["state"]).toBe("awaiting_review");
  });

  it("names the person's handoff file the reset would discard", async () => {
    const run = await stopRun(world);
    const handoff = join(run.worktree, ".phax-context", "correction-handoff.md");
    writeFileSync(handoff, "## What was corrected\n- Nothing yet.\n");

    const call = await phaxCall(["reset-phase", run.shortName, "phase-03"]);
    expect(call.code).toBe(0);

    expect(call.outLines).toContain(`The reset also discards your handoff file: ${handoff}`);
    expect(existsSync(handoff)).toBe(true);
  });

  it("with --yes removes the worktree, the branch and the session files, and discards review-stop.json", async () => {
    const run = await stopRun(world);
    makeCorrections(run);

    const call = await phaxCall(["reset-phase", run.shortName, "--yes"]);
    expect(call.code).toBe(0);

    expect(call.err).toBe("");
    expect(existsSync(run.worktree)).toBe(false);
    const branches = execFileSync("git", ["branch", "--list"], {
      cwd: world.repoRoot,
      encoding: "utf8",
    });
    expect(branches).not.toContain("phase-03");
    expect(existsSync(stopPath(run))).toBe(false);
    expect(existsSync(run.phaseFolder)).toBe(false);
    const archived = readdirSync(run.runPath).find((e) => e.startsWith("phase-03.reset-"))!;
    for (const file of ["interactive-session.json", "first-reading.md", "review-seed.md"]) {
      expect(existsSync(join(run.runPath, archived, file))).toBe(true);
    }
    expect(readJson(statePath(run))["state"]).not.toBe("awaiting_review");
  });

  it("answers its preview and its reset as one JSON value each on the runner, and -y resets as --yes does", async () => {
    const yes = await stopRun(world, { shortName: "invoice-export" });
    const short = await stopRun(world, { shortName: "credit-notes" });
    makeCorrections(yes);
    const { makeResetPhaseCommand } = await import("../../src/cli/definitions/resetPhase.js");
    const { runnerCall } = await import("../helpers/runnerCall.js");
    const call = (argv: string[]) => runnerCall([makeResetPhaseCommand()], argv);

    const preview = await call(["reset-phase", yes.shortName, "phase-03", "--json"]);
    expect(preview.code).toBe(0);
    expect(preview.err).toBe("");
    const previewed = JSON.parse(preview.out) as {
      outcome: { corrections: Array<{ status: string; path: string }> };
    };
    expect(preview.out).toBe(`${JSON.stringify(previewed, null, 2)}\n`);
    expect(previewed).toMatchObject({
      qualifiedName: "example.invoice-export",
      crossProject: false,
      outcome: { kind: "preview", requestedPhaseId: "phase-03", phaseId: "phase-03", atStop: true },
    });
    expect(previewed.outcome.corrections.map((c) => `${c.status} ${c.path}`).toSorted()).toEqual([
      "A src/creditNote.ts",
      "D docs/notes.md",
      "M src/invoiceRow.ts",
    ]);
    expect(existsSync(stopPath(yes))).toBe(true);

    const answers = [];
    for (const [run, flag] of [
      [yes, "--yes"],
      [short, "-y"],
    ] as const) {
      const reset = await call(["reset-phase", run.shortName, flag, "--json"]);
      expect(reset.code).toBe(0);
      expect(reset.err).toBe("");
      const answer = JSON.parse(reset.out) as {
        qualifiedName: string;
        outcome: { archivedPath: string };
      };
      expect(answer.qualifiedName).toBe(`example.${run.shortName}`);
      expect(answer.outcome.archivedPath.startsWith(join(run.runPath, "phase-03.reset-"))).toBe(
        true,
      );
      expect(existsSync(run.worktree)).toBe(false);
      answers.push({ ...answer.outcome, archivedPath: "<archived>" });
    }
    expect(answers[0]).toEqual({
      kind: "reset",
      phaseId: "phase-03",
      archivedPath: "<archived>",
      worktreeRemoved: true,
      branchDeleted: true,
      wasStopped: true,
    });
    expect(answers[1]).toEqual(answers[0]);
  });

  it("refuses to reset phase-02 before the stopped phase-03, naming it, and changes nothing", async () => {
    const run = await stopRun(world);

    for (const opts of [["--yes"], []]) {
      const call = await phaxCall(["reset-phase", run.shortName, "phase-02", ...opts]);
      expect(call.code).toBe(1);
      expect(call.err).toContain(
        'Cannot reset "phase-02" of run "invoice-export": the run is awaiting review at "phase-03". Reset "phase-03" first (`phax reset-phase invoice-export phase-03`).',
      );
    }
    expect(existsSync(stopPath(run))).toBe(true);
    expect(existsSync(run.worktree)).toBe(true);
    expect(existsSync(join(run.runPath, "phase-02", "status.json"))).toBe(true);
    expect(readJson(statePath(run))["state"]).toBe("awaiting_review");
  });
});

const archiveLayers = (lock = makeFakeLock()) =>
  Layer.mergeAll(
    NodeFileSystemLayer,
    NodeGitLayer,
    lock.layer,
    makeFakeShell().layer,
    NoopSystemTelemetryLayer,
  );

describe("phax archive on a waiting run", () => {
  const archiveRun = (run: StoppedRun, force: boolean) =>
    archive(NAMESPACE, run.shortName as ShortName, world.stateRoot, world.repoRoot, { force }).pipe(
      Effect.provide(archiveLayers()),
    );

  it("is refused without --force, naming the state and the flag", async () => {
    const run = await stopRun(world);
    writeRegistry(world, [run]);

    const outcome = await Effect.runPromise(Effect.result(archiveRun(run, false)));

    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isSuccess(outcome)) return;
    expect(outcome.failure).toBeInstanceOf(ArchiveRefusedError);
    expect(outcome.failure.message).toContain("awaiting_review");
    expect(outcome.failure.message).toContain("--force");
    expect(existsSync(stopPath(run))).toBe(true);
  });

  it("with --force archives the run, leaves no review-stop.json and moves the corrected worktree", async () => {
    const run = await stopRun(world);
    writeRegistry(world, [run]);
    writeFileSync(join(run.worktree, "src", "creditNote.ts"), "export const credit = true;\n");

    await Effect.runPromise(archiveRun(run, true));

    const archived = join(world.stateRoot, "archive", run.runKey);
    expect(existsSync(run.runPath)).toBe(false);
    expect(existsSync(join(archived, "runs", "review-stop.json"))).toBe(false);
    expect(existsSync(stopPath(run))).toBe(false);
    expect(
      readFileSync(join(archived, "worktrees", "phase-03", "src", "creditNote.ts"), "utf8"),
    ).toBe("export const credit = true;\n");
    expect(readJson(join(archived, "runs", "run-status.json"))["state"]).toBe("archived");
  });
});

describe("phax adjust-plan --landed on a waiting run", () => {
  it("is refused, naming awaiting_review, before any session starts", async () => {
    const run = await stopRun(world);

    const call = await phaxCall([
      "adjust-plan",
      "docs/plans/2610221000-credit-notes-plan.md",
      "--landed",
      run.shortName,
    ]);

    expect(call.code).toBe(1);
    expect(call.err).toContain("awaiting_review");
    expect(call.err).toContain("has not landed");
    expect(fakeSession.impl.invocations).toHaveLength(0);
  });
});

describe("the phase guard inside a stopped phase's worktree", () => {
  const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

  it("refuses phax resume and phax enter-phase, and the run stays awaiting_review", async () => {
    const run = await stopRun(world);
    const home = join(world.root, "home");
    mkdirSync(home, { recursive: true });
    const before = readFileSync(stopPath(run), "utf8");

    for (const args of [
      ["resume", run.shortName],
      ["enter-phase", run.shortName, "phase-03"],
    ]) {
      const result = spawnSync("tsx", [mainTs, ...args], {
        cwd: run.worktree,
        encoding: "utf8",
        env: { ...process.env, HOME: home },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `✗ phax ${args[0]} is not available inside a phase worktree; run it from the main checkout`,
      );
    }
    expect(readJson(statePath(run))["state"]).toBe("awaiting_review");
    expect(readFileSync(stopPath(run), "utf8")).toBe(before);
  }, 30_000);
});
