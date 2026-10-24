import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterPhase, planEnterPhase } from "../../src/app/enterPhase.js";
import { writeAgentBinding } from "../../src/app/agentBinding.js";
import { readInteractiveSession } from "../../src/app/interactiveFiles.js";
import { resolveRun } from "../../src/app/resolveRunInfo.js";
import type { ClaudeSessionId, ShortName } from "../../src/domain/branded.js";
import { freshStartPrompt } from "../../src/domain/interactive/turnPrompts.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { makeFakeSession } from "../../src/infra/fakes/session.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { Lock } from "../../src/ports/lock.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import {
  FIRST_READING,
  NAMESPACE,
  SESSION_X1,
  createWorld,
  patchJson,
  readJson,
  resolvedConfig,
  stopRun,
  type StoppedRun,
  type World,
} from "../helpers/stoppedRunFixture.js";

// The made-up invoice-export run stopped at its interactive phase-03 by the
// real stop, then acted on through `phax enter-phase`. A fake Session records
// what would be spawned; a fake backend plays the provider of a new turn.

const session = vi.hoisted(() => ({ current: undefined as unknown as { layer: unknown } }));

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/infra/session.js", () => ({
  makeNodeSessionLayer: () => session.current.layer,
}));
// No test reads ~/.phax: providers.json is the built-in catalog.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const { Effect: E } = await import("effect");
  const { DEFAULT_PROVIDER_CONFIG: defaults } =
    await import("../../src/domain/routing/defaults.js");
  return { ...original, loadProviderConfig: () => E.succeed(defaults) };
});

const SESSION_X2 = "X2" as ClaudeSessionId;
const SESSION_X9 = "X9";

let world: World;
let fakeSession: ReturnType<typeof makeFakeSession>;

beforeEach(async () => {
  world = createWorld();
  fakeSession = makeFakeSession();
  session.current = fakeSession as unknown as { layer: unknown };
  const { loadConfig } = await import("../../src/app/loadConfig.js");
  vi.mocked(loadConfig).mockReturnValue(Either.right(resolvedConfig(world)));
});

afterEach(() => {
  vi.clearAllMocks();
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

async function enter(
  run: StoppedRun,
  phaseId: string,
  opts: { newSession?: boolean } = {},
): Promise<{ code: number; logs: string[]; warns: string[]; errors: string[] }> {
  const { runEnterPhase } = await import("../../src/cli/commands/enterPhase.js");
  const output = makeOutput();
  const code = await runEnterPhase(run.shortName, phaseId, output.out, opts);
  return { code, logs: output.logs, warns: output.warns, errors: output.errors };
}

const sessionOf = (run: StoppedRun) =>
  Effect.runPromise(
    readInteractiveSession(run.phaseFolder).pipe(Effect.provide(NodeFileSystemLayer)),
  );

// A fake provider whose next new turn answers a valid first reading as `sessionId`.
const answering = (sessionId: ClaudeSessionId) => {
  const backend = makeFakeBackend();
  backend.impl.addRunResponse({
    sessionId,
    outputPath: "",
    finalText: JSON.stringify(FIRST_READING),
  });
  return backend;
};

// The stopped phase's posture, recorded for another phase of the run.
const copySecurity = (run: StoppedRun, folder: string): void => {
  const security = readFileSync(join(run.phaseFolder, "security.json"), "utf8");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "security.json"), security);
};

const only = <T>(items: readonly T[]): T => {
  expect(items).toHaveLength(1);
  return items[0]!;
};

describe("phax enter-phase at a declared stop", () => {
  it("spawns codex resume X1 in the stopped worktree, carrying the decided posture", async () => {
    const run = await stopRun(world, { provider: "codex-cli", model: "gpt-6-sol" });
    const result = await enter(run, "phase-03");

    expect(result.code).toBe(0);
    const spawned = only(fakeSession.impl.invocations);
    expect(spawned).toMatchObject({ executable: "codex", cwd: run.worktree, env: {} });
    expect(spawned.args.slice(0, 6)).toEqual([
      "resume",
      "X1",
      "-m",
      "gpt-6-sol",
      "-c",
      'model_reasoning_effort="medium"',
    ]);
    // q-continue-approvals: the sandbox flags with on-request approvals.
    expect(spawned.args).toContain('sandbox_mode="workspace-write"');
    expect(spawned.args).toContain('approval_policy="on-request"');
    expect(spawned.args).toContain("sandbox_workspace_write.network_access=false");
    expect(spawned.args.join(" ")).toContain(run.worktree);
    expect(result.logs.join("\n")).toContain(`Continuing codex-cli session X1 in ${run.worktree}`);
    expect(result.logs.join("\n")).toContain("asks you to trust the directory");
  });

  it("spawns the fresh-start command for a stop whose first turn failed", async () => {
    const run = await stopRun(world, {
      provider: "codex-cli",
      model: "gpt-6-sol",
      sessionId: undefined,
    });
    const result = await enter(run, "phase-03");

    expect(result.code).toBe(0);
    const spawned = only(fakeSession.impl.invocations);
    expect(spawned.executable).toBe("codex");
    expect(spawned.args[0]).not.toBe("resume");
    expect(spawned.args.at(-1)).toBe(freshStartPrompt("phase-03"));
    expect(spawned.cwd).toBe(run.worktree);
    expect(result.logs.join("\n")).toContain("No session is current");
  });

  it("prints the unverified warning and the fresh start for a vibe stop, keeping nothing of the new session", async () => {
    const run = await stopRun(world, { provider: "mistral-vibe", model: "devstral-2" });
    const result = await enter(run, "phase-03");

    expect(result.code).toBe(0);
    const spawned = only(fakeSession.impl.invocations);
    expect(spawned.executable).toBe("vibe");
    expect(spawned.args).toContain("--workdir");
    expect(Object.values(spawned.env)).toContain("devstral-2");
    expect(result.warns.join("\n")).toContain("will not be captured");
    // The current session stays recorded for the closing turn.
    const recorded = await Effect.runPromise(
      readInteractiveSession(run.phaseFolder).pipe(Effect.provide(NodeFileSystemLayer)),
    );
    expect(recorded?.current?.sessionId).toBe(SESSION_X1);
  });

  it("refuses a run whose close is in progress, naming the close and phax resume", async () => {
    const run = await stopRun(world);
    patchJson(join(run.runPath, "run-status.json"), { state: "running" });
    const result = await enter(run, "phase-03");

    expect(result.code).toBe(1);
    expect(result.errors.join("\n")).toContain("close");
    expect(result.errors.join("\n")).toContain("phax resume invoice-export");
    expect(fakeSession.impl.invocations).toHaveLength(0);
  });

  it("refuses --new-session on a phase that is not stopped, naming its state", async () => {
    const run = await stopRun(world);
    const result = await enter(run, "phase-01", { newSession: true });

    expect(result.code).toBe(1);
    expect(result.errors.join("\n")).toBe(
      '--new-session needs a phase that is stopped for review; phase "phase-01" of run "example.invoice-export" is committed.',
    );
    expect(fakeSession.impl.invocations).toHaveLength(0);
  });
});

describe("phax enter-phase at a headless phase", () => {
  async function bindHeadless(run: StoppedRun, provider: "codex-cli" | "claude-code") {
    const folder = join(run.runPath, "phase-01");
    const worktree = join(world.stateRoot, "worktrees", run.runKey, "phase-01");
    mkdirSync(worktree, { recursive: true });
    await writeAgentBinding(folder, {
      version: 1,
      shortName: run.shortName,
      runId: run.runId,
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "Export port",
      provider,
      adapter: provider === "codex-cli" ? "codex" : "claude",
      model: provider === "codex-cli" ? "gpt-6-sol" : "claude-sonnet-5-5",
      effort: "medium",
      sessionId: SESSION_X9,
      sessionHandle: null,
      worktreePath: worktree,
      cwd: worktree,
      launchedAt: "2026-10-22T09:00:00.000Z",
      status: "completed",
    });
    return { folder, worktree };
  }

  it("spawns codex resume X9 in phase-01's worktree, carrying the posture (carry-posture)", async () => {
    const run = await stopRun(world, { provider: "codex-cli", model: "gpt-6-sol" });
    const { folder, worktree } = await bindHeadless(run, "codex-cli");
    copySecurity(run, folder);

    const result = await enter(run, "phase-01");

    expect(result.code).toBe(0);
    const spawned = only(fakeSession.impl.invocations);
    expect(spawned).toMatchObject({ executable: "codex", cwd: worktree });
    expect(spawned.args.slice(0, 2)).toEqual(["resume", "X9"]);
    expect(spawned.args).toContain('approval_policy="on-request"');
    expect(spawned.args).toContain('sandbox_mode="workspace-write"');
  });

  it("carries the posture on a claude phase too", async () => {
    const run = await stopRun(world);
    const { folder, worktree } = await bindHeadless(run, "claude-code");
    copySecurity(run, folder);

    const result = await enter(run, "phase-01");

    expect(result.code).toBe(0);
    const spawned = only(fakeSession.impl.invocations);
    expect(spawned).toMatchObject({ executable: "claude", cwd: worktree, env: {} });
    expect(spawned.args.slice(0, 2)).toEqual(["--resume", "X9"]);
    expect(spawned.args).toContain("--permission-mode");
    expect(spawned.args).toContain("acceptEdits");
  });

  it("refuses a phase whose security.json is missing rather than open it unconfined", async () => {
    const run = await stopRun(world, { provider: "codex-cli", model: "gpt-6-sol" });
    await bindHeadless(run, "codex-cli");

    const result = await enter(run, "phase-01");

    expect(result.code).toBe(1);
    expect(result.errors.join("\n")).toContain("security.json");
    expect(result.errors.join("\n")).toContain("will not open its session unconfined");
    expect(fakeSession.impl.invocations).toHaveLength(0);
  });
});

describe("planEnterPhase and a closed interactive phase", () => {
  it("plans without spawning, and continues a closed phase's current session", async () => {
    const run = await stopRun(world, { provider: "codex-cli", model: "gpt-6-sol" });
    // The close committed: the run moved on and phase-03 reads committed.
    patchJson(join(run.runPath, "run-status.json"), { state: "running" });
    patchJson(join(run.phaseFolder, "status.json"), {
      state: "committed",
      commitHash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      stop: {
        cause: "declared",
        status: "closed",
        outcome: "corrected",
        oracleStep: "none",
        closedBy: { name: "Ada Example", email: "ada@example.com" },
      },
    });
    const info = Either.getOrThrow(
      resolveRun(NAMESPACE, run.shortName as ShortName, world.stateRoot),
    );

    const planned = await Effect.runPromise(
      planEnterPhase({
        namespace: NAMESPACE,
        shortName: run.shortName,
        info,
        phaseId: "phase-03",
        newSession: false,
        stateRoot: world.stateRoot,
        providerConfig: DEFAULT_PROVIDER_CONFIG,
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    expect(planned.kind).toBe("command");
    if (planned.kind !== "command") return;
    expect(planned.command.args.slice(0, 2)).toEqual(["resume", "X1"]);
    expect(fakeSession.impl.invocations).toHaveLength(0);
  });
});

const reviewStopPath = (run: StoppedRun): string => join(run.runPath, "review-stop.json");

function layers(
  backend: ReturnType<typeof makeFakeBackend>,
  lock: Layer.Layer<Lock> = makeFakeLock().layer,
) {
  return Layer.mergeAll(
    backend.layer,
    NodeFileSystemLayer,
    NodeGitLayer,
    lock,
    NoopSystemTelemetryLayer,
  );
}

describe("phax enter-phase --new-session", () => {
  function request(run: StoppedRun) {
    const info = Either.getOrThrow(
      resolveRun(NAMESPACE, run.shortName as ShortName, world.stateRoot),
    );
    return {
      namespace: NAMESPACE,
      shortName: run.shortName,
      info,
      phaseId: "phase-03",
      newSession: true,
      stateRoot: world.stateRoot,
      providerConfig: DEFAULT_PROVIDER_CONFIG,
    };
  }

  it("runs a new first turn under the lock, makes X2 current, keeps X1 and refreshes review-stop.json", async () => {
    const run = await stopRun(world, { provider: "codex-cli", model: "gpt-6-sol" });
    const lock = makeFakeLock();
    const backend = answering(SESSION_X2);

    const result = await Effect.runPromise(
      enterPhase(request(run)).pipe(Effect.provide(layers(backend, lock.layer))),
    );

    expect(backend.impl.runCalls).toHaveLength(1);
    expect(backend.impl.runCalls[0]!.options).toMatchObject({ readOnly: true, cwd: run.worktree });
    expect(result.kind).toBe("command");
    if (result.kind !== "command") return;
    expect(result.command.args.slice(0, 2)).toEqual(["resume", "X2"]);
    expect(result.notices[0]!.text).toContain("First turn: new codex-cli session X2");

    const recorded = await sessionOf(run);
    expect(recorded?.current).toMatchObject({ sessionId: "X2", origin: "new-session" });
    expect(recorded?.history.map((s) => s.sessionId)).toEqual(["X1"]);
    expect(recorded?.firstTurns.map((t) => t.outcome)).toEqual(["answered", "answered"]);

    const stop = readJson(reviewStopPath(run));
    expect(Object.keys(stop)[0]).toBe("$schema");
    expect(stop["session"]).toMatchObject({ sessionId: "X2", origin: "new-session" });
    expect(
      (stop["commands"] as { continue: { argv: string[] } }).continue.argv.slice(0, 2),
    ).toEqual(["codex", "resume"]);
    expect((stop["commands"] as { continue: { argv: string[] } }).continue.argv).toContain("X2");
    // The lock was released before the session starts.
    expect(lock.impl.statuses.get(`${NAMESPACE}.${run.shortName}`)).toEqual({ kind: "none" });
  });

  it("keeps X1 and review-stop.json as they were when the new turn fails", async () => {
    const run = await stopRun(world, { provider: "codex-cli", model: "gpt-6-sol" });
    const before = readFileSync(reviewStopPath(run), "utf8");
    const backend = makeFakeBackend();
    backend.impl.failRunWithRateLimit(0, { kind: "rate_limit", resetAt: "2026-10-22T14:20:00Z" });

    const result = await Effect.runPromise(
      enterPhase(request(run)).pipe(Effect.provide(layers(backend))),
    );

    expect(readFileSync(reviewStopPath(run), "utf8")).toBe(before);
    const recorded = await sessionOf(run);
    expect(recorded?.current?.sessionId).toBe("X1");
    expect(recorded?.firstTurns.at(-1)).toMatchObject({ outcome: "failed", reason: "rate-limit" });
    expect(result.kind).toBe("command");
    if (result.kind !== "command") return;
    expect(result.command.args.slice(0, 2)).toEqual(["resume", "X1"]);
    expect(result.notices[0]!.text).toContain("First turn failed (rate-limit");
  });

  it("is refused with the lock conflict (exit 7) while the run lock is held, running no turn", async () => {
    const run = await stopRun(world);
    const lock = makeFakeLock();
    lock.impl.setStatus(`${NAMESPACE}.${run.shortName}`, {
      kind: "active",
      pid: 4242,
      updatedAt: "2026-10-22T10:00:00.000Z",
    });
    const backend = answering(SESSION_X2);

    const outcome = await Effect.runPromise(
      Effect.either(enterPhase(request(run)).pipe(Effect.provide(layers(backend, lock.layer)))),
    );

    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isRight(outcome)) return;
    expect(outcome.left).toMatchObject({ _tag: "LockConflictError" });
    expect(exitCodeForError(outcome.left)).toBe(7);
    expect(backend.impl.runCalls).toHaveLength(0);
  });

  it("is refused when a close started before the lock was taken, running no turn", async () => {
    const run = await stopRun(world);
    const fake = makeFakeLock();
    const key = `${NAMESPACE}.${run.shortName}`;
    // A close wins the race: the run is `running` by the time the lock is ours.
    const racing = Layer.succeed(Lock, {
      ...fake.impl,
      acquire: (k: string) =>
        Effect.sync(() =>
          patchJson(join(run.runPath, "run-status.json"), { state: "running" }),
        ).pipe(Effect.zipRight(fake.impl.acquire(k))),
      release: (k: string) => fake.impl.release(k),
      renew: (k: string) => fake.impl.renew(k),
      status: (k: string) => fake.impl.status(k),
    });
    const backend = answering(SESSION_X2);

    const result = await Effect.runPromise(
      enterPhase(request(run)).pipe(Effect.provide(layers(backend, racing))),
    );

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.message).toContain("being closed");
    expect(result.message).toContain("phax resume invoice-export");
    expect(backend.impl.runCalls).toHaveLength(0);
    expect(fake.impl.statuses.get(key)).toEqual({ kind: "none" });
    expect(existsSync(reviewStopPath(run))).toBe(true);
  });
});
