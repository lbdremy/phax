import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archive } from "../../src/app/archive.js";
import { enterPhase } from "../../src/app/enterPhase.js";
import { readInteractiveSession } from "../../src/app/interactiveFiles.js";
import { resolveRun } from "../../src/app/resolveRunInfo.js";
import type { ClaudeSessionId, ShortName } from "../../src/domain/branded.js";
import { ArchiveRefusedError } from "../../src/domain/errors.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { makeFakeEditor } from "../../src/infra/fakes/editor.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { makeFakeSession } from "../../src/infra/fakes/session.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Backend, type AgentRunOptions } from "../../src/ports/backend.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import {
  NAMESPACE,
  RUN_KEY,
  SHORT,
  createHeldWorld,
  gitIn,
  readJson,
  startHeldRun,
  worktreeOf,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";
import { patchJson, stopRun } from "../helpers/stoppedRunFixture.js";
import { childEnvUnder } from "../helpers/providerStoreRoots.js";

// The commands that act on a run waiting at a held stop: the made-up
// invoice-export run holding phase-02 (`--hold phase-02`), built by the real
// run loop, stopped at phase-02 with the builder session X0 current. A fake
// session, a fake shell (a script that records its cwd) and a fake editor
// record what would be started.

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
  const { DEFAULT_MODEL_ROUTING: routing, DEFAULT_PROVIDER_CONFIG: defaults } =
    await import("../../src/domain/routing/defaults.js");
  return {
    ...original,
    loadModelRouting: () => E.succeed(routing),
    loadProviderConfig: () => E.succeed(defaults),
  };
});
// The journal would write under ~/.phax: telemetry is off in these tests.
vi.mock("../../src/cli/commands/runLayers.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/cli/commands/runLayers.js")>();
  const { NoopSystemTelemetryLayer: noop } = await import("../../src/ports/systemTelemetry.js");
  return { ...original, makeGlobalTelemetryJournalLayerOrNoop: () => noop };
});

const HOLD_PHASE_02 = { selection: "listed", phases: ["phase-02"] } as const;

let world: HeldWorld;
let run: HeldRun;
let fakeSession: ReturnType<typeof makeFakeSession>;
let fakeEditor: ReturnType<typeof makeFakeEditor>;

beforeEach(async () => {
  world = createHeldWorld();
  vi.stubEnv("HOME", world.home);
  fakeSession = makeFakeSession();
  fakeEditor = makeFakeEditor();
  fakes.session = fakeSession as unknown as { layer: unknown };
  fakes.editor = fakeEditor as unknown as { layer: unknown };
  const started = await startHeldRun(world, HOLD_PHASE_02);
  run = started.run;
  const { loadConfig } = await import("../../src/app/loadConfig.js");
  vi.mocked(loadConfig).mockReturnValue(Either.right(run.config));
}, 30_000);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  world.cleanup();
});

function makeOutput() {
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    out: {
      log: (m: string) => logs.push(m),
      warn: (m: string) => warns.push(m),
      error: (m: string) => errors.push(m),
    },
    logs,
    warns,
    errors,
  };
}

const statePath = () => join(run.runPath, "run-status.json");
const stopPath = () => join(run.runPath, "review-stop.json");
const phaseFolder = () => join(run.runPath, "phase-02");
const tree = () => worktreeOf(run, "phase-02");
const phaseCommit = () => gitIn(tree(), "rev-parse", "HEAD");

function writeRegistry(runs: readonly { shortName: string; runId: string }[]): void {
  writeFileSync(
    join(world.stateRoot, "registry.json"),
    JSON.stringify({
      $schema: currentSchemaUrl("registry"),
      runs: runs.map((r) => ({
        namespace: NAMESPACE,
        shortName: r.shortName,
        runId: r.runId,
        state: "awaiting_review",
        branch: `phax/${r.shortName}`,
        projectName: NAMESPACE,
        phasesCount: 6,
        createdAt: "2026-10-22T09:00:00.000Z",
        updatedAt: "2026-10-22T09:00:00.000Z",
      })),
    }),
  );
}

const sessionOf = () =>
  Effect.runPromise(
    readInteractiveSession(phaseFolder()).pipe(Effect.provide(NodeFileSystemLayer)),
  );

const only = <T>(items: readonly T[]): T => {
  expect(items).toHaveLength(1);
  return items[0]!;
};

describe("phax ls and phax session-info on a held run", () => {
  // The held run beside a declared stop, a failed run and an interrupted one,
  // in one state root.
  async function fourRuns() {
    const shared = {
      root: world.root,
      repoRoot: world.repoRoot,
      stateRoot: world.stateRoot,
      cleanup: () => undefined,
    };
    const declared = await stopRun(shared, { shortName: "credit-notes" });
    const failed = await stopRun(shared, { shortName: "payments-fix" });
    const interrupted = await stopRun(shared, { shortName: "refund-csv" });
    patchJson(join(failed.runPath, "run-status.json"), { state: "failed", lastError: "gate" });
    patchJson(join(interrupted.runPath, "run-status.json"), { state: "interrupted" });
    writeRegistry([{ shortName: SHORT, runId: run.runId }, declared, failed, interrupted]);
    return { declared, failed, interrupted };
  }

  it("lists the held run as awaiting_review (held) with its stopped phase", async () => {
    await fourRuns();
    const { runLs } = await import("../../src/cli/commands/ls.js");
    const { out, logs } = makeOutput();

    expect(await runLs({}, out)).toBe(0);

    const rows = logs.join("\n").split("\n");
    const held = rows.find((l) => l.includes("example.invoice-export"))!;
    expect(held).toContain("awaiting_review (held)");
    expect(held).toContain("2/6 phase-02");
    expect(rows.find((l) => l.includes("example.credit-notes"))).toContain(
      "awaiting_review (declared)",
    );
    for (const name of ["payments-fix", "refund-csv"]) {
      const row = rows.find((l) => l.includes(name))!;
      expect(row).not.toContain("awaiting_review");
    }
  });

  it("lists the held run with the declared one under --awaiting-review, not the others", async () => {
    await fourRuns();
    const { runLs } = await import("../../src/cli/commands/ls.js");
    const { out, logs } = makeOutput();

    expect(await runLs({ awaitingReview: true }, out)).toBe(0);

    const rows = logs.join("\n").split("\n").slice(2);
    expect(rows).toHaveLength(2);
    expect(rows.join("\n")).toContain("example.invoice-export");
    expect(rows.join("\n")).toContain("example.credit-notes");
    expect(rows.join("\n")).not.toContain("payments-fix");
    expect(rows.join("\n")).not.toContain("refund-csv");
  });

  it("session-info prints the state, cause, phase and its commit, worktree and X0 with origin builder", async () => {
    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const { out, logs } = makeOutput();

    expect(await runSessionInfo(SHORT, out)).toBe(0);

    const text = logs.join("\n");
    expect(text).toContain("Status:           awaiting_review (held)");
    expect(text).toContain(
      `Stopped phase:    phase-02 — Invoice CSV record (headless, committed ${phaseCommit().slice(0, 7)}, 2/6)`,
    );
    expect(text).toContain(`Worktree:         ${tree()}`);
    expect(text).toContain(
      `Seed:             ${join(tree(), ".phax-context", "interactive-review.md")}`,
    );
    expect(text).toContain(
      "Session:          codex-cli X0 (builder; continue: phax enter-phase invoice-export phase-02)",
    );
  });

  it("session-info prints the session as none when the builder recorded no id", async () => {
    const stop = readJson(stopPath());
    writeFileSync(stopPath(), JSON.stringify({ ...stop, session: null }, null, 2));
    const { runSessionInfo } = await import("../../src/cli/commands/sessionInfo.js");
    const { out, logs } = makeOutput();

    expect(await runSessionInfo(SHORT, out)).toBe(0);

    expect(logs.join("\n")).toContain("Session:          none");
  });
});

describe("phax path, shell and open on a held run", () => {
  it("target the held phase's worktree", async () => {
    const recorded = join(world.root, "shell-cwd.txt");
    const script = join(world.root, "fake-shell.sh");
    writeFileSync(script, `#!/bin/sh\npwd -P > "${recorded}"\n`);
    chmodSync(script, 0o755);
    vi.stubEnv("SHELL", script);

    const { runPath } = await import("../../src/cli/commands/path.js");
    const { runShell } = await import("../../src/cli/commands/shell.js");
    const { runOpen } = await import("../../src/cli/commands/open.js");

    const pathOut = makeOutput();
    expect(runPath(SHORT, pathOut.out)).toBe(0);
    expect(pathOut.logs).toEqual([tree()]);

    expect(await runShell(SHORT, makeOutput().out)).toBe(0);
    expect(readFileSync(recorded, "utf8").trim()).toBe(tree());

    expect(await runOpen(SHORT, makeOutput().out)).toBe(0);
    expect(fakeEditor.impl.openCalls).toEqual([tree()]);
  });
});

describe("phax enter-phase at a held stop", () => {
  it("spawns codex resume X0 in phase-02's worktree with the phase's model, effort and posture", async () => {
    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const { out, logs, errors } = makeOutput();

    expect(await runEnterPhase(SHORT, "phase-02", out, {})).toBe(0);

    expect(errors).toEqual([]);
    const spawned = only(fakeSession.impl.invocations);
    expect(spawned).toMatchObject({ executable: "codex", cwd: tree(), env: {} });
    expect(spawned.args.slice(0, 2)).toEqual(["resume", "X0"]);
    expect(spawned.args.slice(2, 4)).toEqual(["-m", expect.stringContaining("gpt-6")]);
    expect(spawned.args).toContain('model_reasoning_effort="medium"');
    // The fixture's phase ran under the unsafe profile, so it keeps its unsafe flag.
    expect(spawned.args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(logs.join("\n")).toContain(
      `Continuing codex-cli session X0 (the session that built phase-02) in ${tree()}`,
    );
  });

  it("runs the fresh-start command when the stop has no current session", async () => {
    const files = join(phaseFolder(), "interactive-session.json");
    writeFileSync(files, JSON.stringify({ ...readJson(files), current: null }, null, 2));
    const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
    const { out, logs } = makeOutput();

    expect(await runEnterPhase(SHORT, "phase-02", out, {})).toBe(0);

    const spawned = only(fakeSession.impl.invocations);
    expect(spawned.executable).toBe("codex");
    expect(spawned.args[0]).not.toBe("resume");
    expect(spawned.cwd).toBe(tree());
    expect(logs.join("\n")).toContain("No session is current");
  });
});

const FIRST_READING = JSON.stringify({
  $schema: currentSchemaUrl("first-reading"),
  pattern: ["The InvoiceRow column order"],
  copiedBy: [{ phase: "phase-04", what: "the column order" }],
  toCheck: ["Whether `invoice_no` should read `Invoice number`"],
});

const unused = () => Effect.die("not played by this test");

// A provider whose read-only turn answers a first reading as `sessionId`, after
// `during` ran in the worktree.
function turnLayer(sessionId: string, during?: (cwd: string) => void) {
  const calls: AgentRunOptions[] = [];
  const layer = Layer.succeed(Backend, {
    runAgent: (_prompt: string, options: AgentRunOptions) =>
      Effect.sync(() => {
        calls.push(options);
        during?.(options.cwd);
        return {
          sessionId: sessionId as ClaudeSessionId,
          outputPath: "",
          finalText: FIRST_READING,
        };
      }),
    resumeAgentSession: unused,
    complete: unused,
    probe: unused,
  } as never);
  return { layer, calls };
}

function newSessionRequest() {
  const info = Either.getOrThrow(resolveRun(NAMESPACE, SHORT as ShortName, world.stateRoot));
  return {
    namespace: NAMESPACE,
    shortName: SHORT,
    info,
    phaseId: "phase-02",
    newSession: true,
    stateRoot: world.stateRoot,
    providerConfig: DEFAULT_PROVIDER_CONFIG,
  };
}

const enterLayers = (backend: Layer.Layer<Backend>) =>
  Layer.mergeAll(
    backend,
    NodeFileSystemLayer,
    NodeGitLayer,
    makeFakeLock().layer,
    NoopSystemTelemetryLayer,
  );

describe("phax enter-phase --new-session at a held stop", () => {
  it("makes X2 current, keeps X0 in history, writes first-reading.md and keeps review-stop.json held", async () => {
    const before = readJson(stopPath());
    const provider = turnLayer("X2");

    const result = await Effect.runPromise(
      enterPhase(newSessionRequest()).pipe(Effect.provide(enterLayers(provider.layer))),
    );

    expect(only(provider.calls)).toMatchObject({ readOnly: true, cwd: tree() });
    expect(result.kind).toBe("command");
    if (result.kind !== "command") return;
    expect(result.command.executable).toBe("codex");
    expect(result.command.args.slice(0, 2)).toEqual(["resume", "X2"]);
    expect(result.command.cwd).toBe(tree());

    const recorded = await sessionOf();
    expect(recorded?.current).toMatchObject({ sessionId: "X2", origin: "new-session" });
    expect(recorded?.history.map((s) => [s.sessionId, s.origin])).toEqual([["X0", "builder"]]);
    expect(existsSync(join(phaseFolder(), "first-reading.md"))).toBe(true);

    // Only `session` and `commands.continue` changed; the held variant survives.
    const stop = readJson(stopPath());
    expect(Object.keys(stop)[0]).toBe("$schema");
    expect(stop).toMatchObject({ cause: "held", phaseCommit: phaseCommit() });
    expect(stop["session"]).toMatchObject({
      provider: "codex-cli",
      sessionId: "X2",
      origin: "new-session",
      interactiveResume: "verified",
    });
    const commands = stop["commands"] as Record<string, { argv: string[] }>;
    expect(commands["continue"]!.argv.slice(0, 2)).toEqual(["codex", "resume"]);
    expect(commands["continue"]!.argv).toContain("X2");
    const beforeCommands = before["commands"] as Record<string, unknown>;
    expect({ ...commands, continue: null }).toEqual({ ...beforeCommands, continue: null });
    expect({ ...stop, session: null, commands: null }).toEqual({
      ...before,
      session: null,
      commands: null,
    });
  });

  it("sets a turn that wrote a file aside in refused-turn-01, restores the worktree and keeps X0 current", async () => {
    const stopBefore = readFileSync(stopPath(), "utf8");
    const header = readFileSync(join(tree(), "src", "invoiceRow.ts"), "utf8");
    const provider = turnLayer("X2", (cwd) =>
      writeFileSync(join(cwd, "src", "invoiceRow.ts"), "export const header = 'oops';\n"),
    );

    const result = await Effect.runPromise(
      enterPhase(newSessionRequest()).pipe(Effect.provide(enterLayers(provider.layer))),
    );

    expect(readFileSync(join(tree(), "src", "invoiceRow.ts"), "utf8")).toBe(header);
    expect(gitIn(tree(), "status", "--porcelain")).toBe("");
    const kept = join(phaseFolder(), "refused-turn-01");
    expect(readFileSync(join(kept, "src", "invoiceRow.ts"), "utf8")).toBe(
      "export const header = 'oops';\n",
    );
    const recorded = await sessionOf();
    expect(recorded?.current?.sessionId).toBe("X0");
    expect(recorded?.history).toEqual([]);
    expect(recorded?.firstTurns.at(-1)).toMatchObject({ outcome: "refused-change" });
    expect(readFileSync(stopPath(), "utf8")).toBe(stopBefore);
    expect(result.kind).toBe("command");
    if (result.kind !== "command") return;
    expect(result.command.args.slice(0, 2)).toEqual(["resume", "X0"]);
    expect(result.notices[0]!.text).toContain("First turn refused");
  });
});

// Two uncommitted corrections: one modified, one added file.
function makeCorrections(): void {
  writeFileSync(join(tree(), "src", "invoiceRow.ts"), "export const header = 'Invoice number';\n");
  writeFileSync(join(tree(), "src", "creditNote.ts"), "export const credit = true;\n");
}

describe("phax reset-phase on a held run", () => {
  it("previews the phase commit and the two corrections, and changes nothing without --yes", async () => {
    const c2 = phaseCommit();
    makeCorrections();
    const { runResetPhase } = await import("../../src/cli/commands/resetPhase.js");
    const { out, logs, errors } = makeOutput();

    expect(await runResetPhase(SHORT, "phase-02", {}, out)).toBe(0);

    const text = logs.join("\n");
    expect(text).toContain(
      `This discards phase-02's commit ${c2.slice(0, 7)} and 2 uncommitted review corrections in ${tree()}:`,
    );
    expect(text).toContain("  A src/creditNote.ts");
    expect(text).toContain("  M src/invoiceRow.ts");
    expect(text).toContain(
      "phax resume example.invoice-export will run phase-02 again from its start and hold it again.",
    );
    expect(errors).toEqual([]);
    expect(existsSync(stopPath())).toBe(true);
    expect(existsSync(tree())).toBe(true);
    expect(readJson(statePath())["state"]).toBe("awaiting_review");
  });

  it("with --yes removes the worktree, the branch with C2 and the session files", async () => {
    makeCorrections();
    const { runResetPhase } = await import("../../src/cli/commands/resetPhase.js");
    const { out, errors } = makeOutput();

    expect(await runResetPhase(SHORT, undefined, { yes: true }, out)).toBe(0);

    expect(errors).toEqual([]);
    expect(existsSync(tree())).toBe(false);
    expect(gitIn(world.repoRoot, "branch", "--list", `phax/${SHORT}--phase-02`)).toBe("");
    expect(existsSync(stopPath())).toBe(false);
    expect(existsSync(phaseFolder())).toBe(false);
    const archived = readdirSync(run.runPath).find((e) => e.startsWith("phase-02.reset-"))!;
    for (const file of ["interactive-session.json", "review-seed.md"]) {
      expect(existsSync(join(run.runPath, archived, file))).toBe(true);
    }
    expect(readJson(statePath())["state"]).not.toBe("awaiting_review");
  });

  it("refuses to reset phase-01 before the held phase-02, naming it, and changes nothing", async () => {
    const { runResetPhase } = await import("../../src/cli/commands/resetPhase.js");

    for (const opts of [{ yes: true }, {}]) {
      const { out, errors } = makeOutput();
      expect(await runResetPhase(SHORT, "phase-01", opts, out)).toBe(1);
      expect(errors.join("\n")).toContain(
        'Cannot reset "phase-01" of run "invoice-export": the run is awaiting review at "phase-02". Reset "phase-02" first (`phax reset-phase invoice-export phase-02`).',
      );
    }
    expect(existsSync(stopPath())).toBe(true);
    expect(existsSync(tree())).toBe(true);
    expect(existsSync(join(run.runPath, "phase-01", "status.json"))).toBe(true);
    expect(readJson(statePath())["state"]).toBe("awaiting_review");
  });
});

describe("phax archive and adjust-plan on a held run", () => {
  const archiveRun = (force: boolean) =>
    archive(NAMESPACE, SHORT as ShortName, world.stateRoot, world.repoRoot, { force }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeFileSystemLayer,
          NodeGitLayer,
          makeFakeLock().layer,
          makeFakeShell().layer,
          NoopSystemTelemetryLayer,
        ),
      ),
    );

  it("refuses archive without --force, naming the state and the flag", async () => {
    writeRegistry([{ shortName: SHORT, runId: run.runId }]);

    const outcome = await Effect.runPromise(Effect.either(archiveRun(false)));

    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isRight(outcome)) return;
    expect(outcome.left).toBeInstanceOf(ArchiveRefusedError);
    expect(outcome.left.message).toContain("awaiting_review");
    expect(outcome.left.message).toContain("--force");
    expect(existsSync(stopPath())).toBe(true);
  });

  it("archives the run with --force, leaving no review-stop.json", async () => {
    writeRegistry([{ shortName: SHORT, runId: run.runId }]);

    await Effect.runPromise(archiveRun(true));

    const archived = join(world.stateRoot, "archive", RUN_KEY);
    expect(existsSync(run.runPath)).toBe(false);
    expect(existsSync(join(archived, "runs", "review-stop.json"))).toBe(false);
    expect(readJson(join(archived, "runs", "run-status.json"))["state"]).toBe("archived");
  });

  it("refuses adjust-plan --landed, naming awaiting_review, before any session starts", async () => {
    const { runAdjustPlan } = await import("../../src/cli/commands/adjustPlan.js");
    const { out, errors } = makeOutput();

    const code = await runAdjustPlan(
      "docs/plans/2610221000-credit-notes-plan.md",
      { landed: SHORT },
      out,
    );

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("awaiting_review");
    expect(errors.join("\n")).toContain("has not landed");
    expect(fakeSession.impl.invocations).toHaveLength(0);
  });
});

describe("the phase guard inside a held phase's worktree", () => {
  const mainTs = join(fileURLToPath(import.meta.url), "../../../src/cli/main.ts");

  it("refuses phax resume and phax enter-phase, and the run stays awaiting_review", () => {
    const home = join(world.root, "guard-home");
    mkdirSync(home, { recursive: true });
    const before = readFileSync(stopPath(), "utf8");

    for (const args of [
      ["resume", SHORT],
      ["enter-phase", SHORT, "phase-02"],
    ]) {
      const result = spawnSync("tsx", [mainTs, ...args], {
        cwd: tree(),
        encoding: "utf8",
        env: childEnvUnder(home),
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `✗ phax ${args[0]} is not available inside a phase worktree; run it from the main checkout`,
      );
    }
    expect(readJson(statePath())["state"]).toBe("awaiting_review");
    expect(readFileSync(stopPath(), "utf8")).toBe(before);
  }, 30_000);
});
