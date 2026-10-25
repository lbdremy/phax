import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeStop, type CloseReport } from "../../src/app/closeStop.js";
import { dispatch } from "../../src/app/dispatcher.js";
import type { ClaudeSessionId, PhaseId, RunId } from "../../src/domain/branded.js";
import { StopCloseRefusedError } from "../../src/domain/errors.js";
import { PERSON_HANDOFF_PATH } from "../../src/domain/interactive/worktreeChange.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { FakeBackendImpl, makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { makeInMemoryTelemetryLayer } from "../../src/infra/telemetry/inMemory.js";
import { Backend, type BackendOps } from "../../src/ports/backend.js";
import { FileSystem, FsError } from "../../src/ports/fs.js";
import { Git, GitError, type GitOps } from "../../src/ports/git.js";
import { Shell } from "../../src/ports/shell.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import { providerStoreRootsUnder } from "../helpers/providerStoreRoots.js";
import {
  SHORT,
  createHeldWorld,
  gitIn as heldGit,
  startHeldRun,
  worktreeOf,
  readJson as readHeldJson,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";
import {
  createWorld,
  readJson,
  resolvedConfig,
  stopRun,
  type StoppedRun,
  type World,
} from "../helpers/stoppedRunFixture.js";

// The made-up invoice-export run's two stops, closed through `closeStop`
// against the real file system, real git and the real codex adapter reading a
// store under the test's own HOME: the declared stop at phase-03 (the first
// turn's session X1, never continued, and a `--new-session` session X2 the
// person continued) and the stop held at phase-02 (the builder's session X0).
// The fake backend plays the closing turn.

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

const GATE_STEPS: readonly GateStep[] = [
  { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
  { command: "pnpm test", surface: "local", firing: "every-phase", output: "log" },
  { command: "pnpm e2e", surface: "product", firing: "terminal", output: "log" },
];

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

// Not valid UTF-8: a lone 0xff, 0xfe and a truncated two-byte sequence.
const INVALID_UTF8 = Uint8Array.from([0x7b, 0xff, 0xfe, 0x0a, 0xc3, 0x28, 0x7d, 0x0a]);

const digestOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const PHASE_03: PhaxPlanPhase = {
  id: "phase-03",
  title: "Review the export record",
  model: "gpt-6",
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

// ── Helpers ────────────────────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, "0");

// Where a codex rollout of a session that started at `startedAt` sits in the store.
function rolloutPath(home: string, sessionId: string, startedAt: string): string {
  const d = new Date(startedAt);
  const day = `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
  const stamp = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`;
  return join(home, ".codex", "sessions", day, `rollout-${stamp}-${sessionId}.jsonl`);
}

function putRollout(
  home: string,
  sessionId: string,
  startedAt: string,
  content: string | Uint8Array,
): string {
  const path = rolloutPath(home, sessionId, startedAt);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

interface RecordedSessionJson {
  readonly sessionId: string;
  readonly startedAt: string;
}

const sessionDoc = (phaseFolder: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(phaseFolder, "interactive-session.json"), "utf8")) as Record<
    string,
    unknown
  >;

const currentSession = (phaseFolder: string): RecordedSessionJson =>
  sessionDoc(phaseFolder)["current"] as RecordedSessionJson;

const transcriptsOf = (phaseFolder: string) => sessionDoc(phaseFolder)["transcripts"];

const copyOf = (phaseFolder: string, sessionId: string): string =>
  join(phaseFolder, "interactive-transcripts", `${sessionId}.jsonl`);

const copiesIn = (phaseFolder: string): string[] => {
  const folder = join(phaseFolder, "interactive-transcripts");
  return existsSync(folder) ? readdirSync(folder).toSorted() : [];
};

/** The fake backend plays the turns; the real codex adapter reads the store under `home`. */
function withStore(fake: FakeBackendImpl, home: string): BackendOps {
  const real = Effect.runSync(
    Effect.provide(
      Backend,
      Layer.provide(makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG), providerStoreRootsUnder(home)),
    ),
  );
  return {
    runAgent: (prompt, options) => fake.runAgent(prompt, options),
    resumeAgentSession: (sessionId, prompt, options) =>
      fake.resumeAgentSession(sessionId, prompt, options),
    complete: (prompt, options) => fake.complete(prompt, options),
    probe: (prompt, options) => fake.probe(prompt, options),
    captureTranscript: (request) => real.captureTranscript(request),
  };
}

const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));
const realGit = Effect.runSync(Effect.provide(Git, NodeGitLayer));

// Every `pnpm` gate step is green; git runs for real.
const passingShell = Layer.succeed(Shell, {
  run: (options) =>
    options.command[0] !== "pnpm"
      ? realShell.run(options)
      : Effect.succeed({ exitCode: 0, stdout: "", stderr: "", stdoutEncoding: "utf8" as const }),
});

const commitFailure = new GitError({ message: "the disk went away", command: "commit-tree" });

/** A Git whose commit does not happen: the close stops before its commit. */
const gitFailingBeforeCommit: GitOps = {
  ...realGit,
  commitTree: () => Effect.fail(commitFailure),
};

/** A Git whose commit lands and is then reported failed: the close stops after its commit. */
const gitFailingAfterCommit: GitOps = {
  ...realGit,
  commitTree: (...args) =>
    realGit.commitTree(...args).pipe(Effect.flatMap(() => Effect.fail(commitFailure))),
};

/** The real file system, whose byte writes fail where `failing` says. */
const faultyBytes = (failing: (path: string) => boolean) =>
  Layer.effect(
    FileSystem,
    Effect.map(FileSystem, (fs) => ({
      ...fs,
      writeAtomicBytes: (path: string, bytes: Uint8Array, options?: { mode?: number }) =>
        failing(path)
          ? Effect.fail(new FsError({ message: `${path}: no space left on device` }))
          : fs.writeAtomicBytes(path, bytes, options),
    })),
  ).pipe(Layer.provide(NodeFileSystemLayer));

interface Variant {
  readonly git?: GitOps;
  readonly fs?: Layer.Layer<FileSystem>;
}

function layersOf(backend: BackendOps, variant: Variant, telemetry = makeInMemoryTelemetryLayer()) {
  return {
    telemetry: telemetry.impl,
    layer: Layer.mergeAll(
      Layer.succeed(Backend, backend),
      variant.fs ?? NodeFileSystemLayer,
      Layer.succeed(Git, variant.git ?? realGit),
      passingShell,
      telemetry.layer,
    ),
  };
}

const success = (result: Either.Either<CloseReport, unknown>): CloseReport => {
  if (Either.isLeft(result)) throw new Error(`close refused: ${String(result.left)}`);
  return result.right;
};

const refusalOf = (result: Either.Either<CloseReport, unknown>): StopCloseRefusedError => {
  if (Either.isRight(result)) throw new Error("the close was not refused");
  expect(result.left).toBeInstanceOf(StopCloseRefusedError);
  return result.left as StopCloseRefusedError;
};

const modeOf = (path: string): number => statSync(path).mode & 0o777;

// Every ref of the repository holds no path under interactive-transcripts/.
function expectNoBranchHoldsTranscripts(repoRoot: string): void {
  const refs = execFileSync("git", ["for-each-ref", "--format=%(refname)", "refs/heads"], {
    cwd: repoRoot,
    stdio: "pipe",
  })
    .toString()
    .split("\n")
    .filter((ref) => ref !== "");
  expect(refs.length).toBeGreaterThan(1);
  for (const ref of refs) {
    const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", ref], {
      cwd: repoRoot,
      stdio: "pipe",
    }).toString();
    expect(paths, ref).not.toContain("interactive-transcripts");
  }
}

// ── The declared stop ──────────────────────────────────────────────────────

describe("transcripts at a declared stop's close", () => {
  let world: World;
  let home: string;
  let run: StoppedRun;
  let x1Started: string;
  let x2Started: string;

  beforeEach(async () => {
    world = createWorld();
    home = join(world.root, "home");
    mkdirSync(home, { recursive: true });
    vi.stubEnv("HOME", home);
    const { loadConfig } = await import("../../src/app/loadConfig.js");
    vi.mocked(loadConfig).mockReturnValue(Either.right(resolvedConfig(world)));
    run = await stopRun(world, { provider: "codex-cli", model: "gpt-6" });

    // The first turn's session X1 was never continued; the person then entered
    // the phase with `--new-session`, and X2 is the current session.
    const doc = sessionDoc(run.phaseFolder);
    const x1 = doc["current"] as Record<string, unknown>;
    x1Started = x1["startedAt"] as string;
    x2Started = new Date(Date.parse(x1Started) + 60_000).toISOString();
    writeFileSync(
      join(run.phaseFolder, "interactive-session.json"),
      JSON.stringify(
        {
          ...doc,
          history: [x1],
          current: { ...x1, sessionId: "X2", origin: "new-session", startedAt: x2Started },
        },
        null,
        2,
      ),
    );
    putRollout(home, "X1", x1Started, '{"turn":"first reading"}\n');
    putRollout(home, "X2", x2Started, '{"turn":"the person continued"}\n');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    world.cleanup();
  });

  const write = (path: string, content: string): void => {
    mkdirSync(dirname(join(run.worktree, path)), { recursive: true });
    writeFileSync(join(run.worktree, path), content);
  };
  const correct = (): void => write("src/invoiceRow.ts", CORRECTED_HEADER);

  const closeInput = () => ({
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

  const resumeRequested = () =>
    dispatch(
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

  // The closing turn resumes X2, the current session, and its lines land in X2's rollout.
  const answeringX2 = (): FakeBackendImpl => {
    const backend = makeFakeBackend().impl;
    backend.addResumeResponse({
      sessionId: "X2" as ClaudeSessionId,
      outputPath: "",
      finalText: answerText(),
    });
    backend.setOnResumeAgent(() =>
      appendFileSync(rolloutPath(home, "X2", x2Started), '{"turn":"closing turn"}\n'),
    );
    return backend;
  };

  async function close(
    backend: FakeBackendImpl | BackendOps,
    variant: Variant & { readonly resume?: boolean } = {},
  ) {
    const wired = backend instanceof FakeBackendImpl ? withStore(backend, home) : backend;
    const { layer, telemetry } = layersOf(wired, variant);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        if (variant.resume !== false) yield* resumeRequested();
        return yield* Effect.either(closeStop(closeInput()));
      }).pipe(Effect.provide(layer)),
    );
    return { result, telemetry };
  }

  it("copies X1, never continued, and X2 with its closing turn, and records their digests", async () => {
    correct();

    const { result } = await close(answeringX2());
    const closed = success(result);

    expect(copiesIn(run.phaseFolder)).toEqual(["X1.jsonl", "X2.jsonl"]);
    expect(readFileSync(copyOf(run.phaseFolder, "X1"), "utf8")).toBe('{"turn":"first reading"}\n');
    // X2's copy was taken after the closing turn, which resumed X2.
    expect(readFileSync(copyOf(run.phaseFolder, "X2"), "utf8")).toBe(
      '{"turn":"the person continued"}\n{"turn":"closing turn"}\n',
    );
    const x1Digest = digestOf(readFileSync(copyOf(run.phaseFolder, "X1")));
    const x2Digest = digestOf(readFileSync(copyOf(run.phaseFolder, "X2")));
    expect(transcriptsOf(run.phaseFolder)).toEqual([
      { sessionId: "X1", status: "captured", sha256: x1Digest },
      { sessionId: "X2", status: "captured", sha256: x2Digest },
    ]);
    expect(closed.sessions).toEqual([
      {
        provider: "codex-cli",
        model: "gpt-6",
        effort: "medium",
        sessionId: "X1",
        origin: "first-turn",
        transcript: { status: "captured", sha256: x1Digest },
      },
      {
        provider: "codex-cli",
        model: "gpt-6",
        effort: "medium",
        sessionId: "X2",
        origin: "new-session",
        transcript: { status: "captured", sha256: x2Digest },
      },
    ]);
  });

  it("writes the exact bytes of a store file that is not valid UTF-8, privately, and hashes the copy", async () => {
    putRollout(home, "X1", x1Started, INVALID_UTF8);
    correct();

    success((await close(answeringX2())).result);

    const copy = readFileSync(copyOf(run.phaseFolder, "X1"));
    expect(Uint8Array.from(copy)).toEqual(INVALID_UTF8);
    expect(transcriptsOf(run.phaseFolder)).toMatchObject([
      { sessionId: "X1", status: "captured", sha256: digestOf(copy) },
      { sessionId: "X2", status: "captured" },
    ]);
    if (process.platform !== "win32") {
      expect(modeOf(join(run.phaseFolder, "interactive-transcripts"))).toBe(0o700);
      expect(modeOf(copyOf(run.phaseFolder, "X1"))).toBe(0o600);
    }
  });

  it("records a transcript missing from the store, never blocks the close, and traces both", async () => {
    rmSync(rolloutPath(home, "X1", x1Started));
    correct();

    const { result, telemetry } = await close(answeringX2());
    const closed = success(result);

    expect(closed).toMatchObject({ cause: "declared", outcome: "corrected" });
    expect(readJson(join(run.runPath, "run-status.json"))["state"]).toBe("running");
    expect(readJson(join(run.phaseFolder, "status.json"))).toMatchObject({
      state: "committed",
      stop: { cause: "declared", status: "closed", outcome: "corrected" },
    });
    expect(copiesIn(run.phaseFolder)).toEqual(["X2.jsonl"]);
    expect(transcriptsOf(run.phaseFolder)).toMatchObject([
      { sessionId: "X1", status: "missing", reason: "not-found" },
      { sessionId: "X2", status: "captured" },
    ]);

    const events = telemetry.getSemanticTraceSnapshot();
    expect(events.filter((e) => e["type"] === "stop.transcript")).toEqual([
      expect.objectContaining({
        sessionId: "X1",
        provider: "codex-cli",
        outcome: "missing",
        reason: "not-found",
      }),
      expect.objectContaining({ sessionId: "X2", provider: "codex-cli", outcome: "captured" }),
    ]);
    const steps = events
      .filter((e) => e["step"] === "transcripts")
      .map((e) => [e["type"], e["result"]]);
    expect(steps).toEqual([
      ["step.started", undefined],
      ["step.completed", "success"],
    ]);
  });

  it("refuses a session id that would leave the phase folder before any path is built from it", async () => {
    // `../../x` joined under interactive-transcripts/ names <run>/x.jsonl: an
    // earlier copy the close would read and record as captured.
    const escaped = join(run.runPath, "x.jsonl");
    writeFileSync(escaped, '{"turn":"outside the phase folder"}\n');
    const doc = sessionDoc(run.phaseFolder);
    writeFileSync(
      join(run.phaseFolder, "interactive-session.json"),
      JSON.stringify({
        ...doc,
        history: [{ ...(doc["current"] as object), sessionId: "../../x" }],
      }),
    );
    const touched: string[] = [];
    const watching = Layer.effect(
      FileSystem,
      Effect.map(FileSystem, (fs) => ({
        ...fs,
        exists: (path: string) => (touched.push(path), fs.exists(path)),
        readBytes: (path: string) => (touched.push(path), fs.readBytes(path)),
        readText: (path: string) => (touched.push(path), fs.readText(path)),
      })),
    ).pipe(Layer.provide(NodeFileSystemLayer));

    const { result } = await close(makeFakeBackend().impl, { fs: watching });

    refusalOf(result);
    expect(touched.map((path) => resolve(path))).not.toContain(escaped);
    expect(copiesIn(run.phaseFolder)).toEqual([]);
    expect(transcriptsOf(run.phaseFolder)).toBeNull();
  });

  it("captures the sessions of an unchanged close too, with no closing turn", async () => {
    const backend = makeFakeBackend().impl;

    const { result } = await close(backend);
    const closed = success(result);

    expect(closed).toMatchObject({ outcome: "unchanged", handoffSource: "unchanged" });
    expect(backend.resumeCalls).toEqual([]);
    expect(copiesIn(run.phaseFolder)).toEqual(["X1.jsonl", "X2.jsonl"]);
    expect(closed.sessions.map((s) => s.transcript.status)).toEqual(["captured", "captured"]);
  });

  it("captures the sessions of a close that took the person's handoff, with no closing turn", async () => {
    correct();
    write(
      PERSON_HANDOFF_PATH,
      [
        "## What was corrected",
        "- The invoice header reads `Invoice number`.",
        "",
        "## The pattern to follow from now on",
        "- Column headers are human-readable.",
        "",
        "## Guards",
        "- no guard: a one-word label, checked by eye.",
        "",
        "## What the next phases need to know",
        "- phase-04 copies the header wording.",
        "",
      ].join("\n"),
    );
    const backend = makeFakeBackend().impl;

    const closed = success((await close(backend)).result);

    expect(closed.handoffSource).toBe("person");
    expect(backend.resumeCalls).toEqual([]);
    expect(copiesIn(run.phaseFolder)).toEqual(["X1.jsonl", "X2.jsonl"]);
  });

  it("copies again after a close interrupted before its commit, leaving one file and one outcome per session", async () => {
    correct();
    const first = refusalOf((await close(answeringX2(), { git: gitFailingBeforeCommit })).result);
    expect(first.lastClose).toMatchObject({ result: "close-error", step: "commit" });
    const afterFirst = digestOf(readFileSync(copyOf(run.phaseFolder, "X2")));

    // The person kept talking to X2 before closing again.
    appendFileSync(rolloutPath(home, "X2", x2Started), '{"turn":"one more thing"}\n');
    const closed = success((await close(answeringX2())).result);

    expect(copiesIn(run.phaseFolder)).toEqual(["X1.jsonl", "X2.jsonl"]);
    const x2 = readFileSync(copyOf(run.phaseFolder, "X2"));
    expect(digestOf(x2)).not.toBe(afterFirst);
    expect(x2.toString("utf8")).toContain("one more thing");
    const entries = transcriptsOf(run.phaseFolder) as { sessionId: string; sha256: string }[];
    expect(entries.map((e) => e.sessionId)).toEqual(["X1", "X2"]);
    expect(entries[1]!.sha256).toBe(digestOf(x2));
    expect(closed.sessions.map((s) => s.sessionId)).toEqual(["X1", "X2"]);
  });

  it("captures in finishLandedCommit after a close interrupted after its commit, keeping the earlier copy when the store file has gone", async () => {
    correct();
    const first = refusalOf((await close(answeringX2(), { git: gitFailingAfterCommit })).result);
    expect(first.lastClose).toMatchObject({ result: "close-error", step: "commit" });
    const kept = readFileSync(copyOf(run.phaseFolder, "X2"));
    // The store lost X2 and X1 meanwhile.
    rmSync(rolloutPath(home, "X2", x2Started));
    rmSync(rolloutPath(home, "X1", x1Started));

    const backend = makeFakeBackend().impl;
    const closed = success((await close(backend, { resume: true })).result);

    expect(closed.handoffSource).toBe("earlier-close");
    expect(backend.resumeCalls).toEqual([]);
    expect(copiesIn(run.phaseFolder)).toEqual(["X1.jsonl", "X2.jsonl"]);
    expect(readFileSync(copyOf(run.phaseFolder, "X2"))).toEqual(kept);
    expect(transcriptsOf(run.phaseFolder)).toEqual([
      expect.objectContaining({ sessionId: "X1", status: "captured" }),
      { sessionId: "X2", status: "captured", sha256: digestOf(kept) },
    ]);
    expect(closed.sessions.map((s) => s.transcript.status)).toEqual(["captured", "captured"]);
  });

  it("captures in finishLandedCommit a session an interrupted close never copied", async () => {
    // The first close's copy step is the one that failed: nothing was copied, then the commit landed.
    correct();
    const failing = faultyBytes(() => true);
    const refused = refusalOf((await close(answeringX2(), { fs: failing })).result);
    expect(refused.lastClose).toMatchObject({ result: "close-error", step: "files" });
    expect(copiesIn(run.phaseFolder)).toEqual([]);

    const closed = success((await close(answeringX2())).result);

    expect(copiesIn(run.phaseFolder)).toEqual(["X1.jsonl", "X2.jsonl"]);
    expect(closed.sessions.map((s) => s.transcript.status)).toEqual(["captured", "captured"]);
  });

  it("refuses the close as files when a copy cannot be written, committing nothing", async () => {
    correct();
    const tipBefore = gitIn(run.worktree, "rev-parse", "HEAD");

    const { result } = await close(answeringX2(), {
      fs: faultyBytes((path) => path.endsWith("X2.jsonl")),
    });
    const error = refusalOf(result);

    expect(error.lastClose).toMatchObject({ result: "close-error", exitCode: 1, step: "files" });
    expect(gitIn(run.worktree, "rev-parse", "HEAD")).toBe(tipBefore);
    expect(readJson(join(run.runPath, "run-status.json"))["state"]).toBe("awaiting_review");
    expect(readJson(join(run.phaseFolder, "status.json"))).toMatchObject({
      state: "awaiting_review",
    });
    // No outcome was recorded for a copy that was not made.
    expect(transcriptsOf(run.phaseFolder)).toBeNull();
  });

  it("puts no path under interactive-transcripts/ on any branch, and leaves the worktree clean", async () => {
    correct();

    success((await close(answeringX2())).result);

    expect(copiesIn(run.phaseFolder)).toEqual(["X1.jsonl", "X2.jsonl"]);
    expectNoBranchHoldsTranscripts(run.world.repoRoot);
    expect(gitIn(run.worktree, "status", "--porcelain")).toBe("");
    expect(existsSync(join(run.worktree, "interactive-transcripts"))).toBe(false);
  });
});

const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

// ── The held stop ──────────────────────────────────────────────────────────

describe("transcripts at a held stop's close", () => {
  let world: HeldWorld;
  let run: HeldRun;

  beforeEach(async () => {
    world = createHeldWorld();
    vi.stubEnv("HOME", world.home);
    const started = await startHeldRun(world, { selection: "listed", phases: ["phase-02"] });
    run = started.run;
    expect(readHeldJson(join(run.runPath, "run-status.json"))["state"]).toBe("awaiting_review");
    putRollout(
      world.home,
      "X0",
      currentSession(phaseFolder()).startedAt,
      '{"turn":"the builder"}\n',
    );
  }, 30_000);

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    world.cleanup();
  });

  const phaseFolder = (): string => join(run.runPath, "phase-02");
  const tree = (): string => worktreeOf(run, "phase-02");
  const x0Started = (): string => currentSession(phaseFolder()).startedAt;

  const write = (path: string, content: string): void => {
    mkdirSync(dirname(join(tree(), path)), { recursive: true });
    writeFileSync(join(tree(), path), content);
  };
  const correct = (): void => {
    write("src/invoiceRow.ts", CORRECTED_HEADER);
    write("tests/invoiceRow.test.ts", "it('reads Invoice number', () => {});\n");
  };

  const closeInput = () => ({
    runId: run.runId,
    shortName: SHORT,
    runPath: run.runPath,
    phase: run.plan.phases[1]!,
    phaseFolder: phaseFolder(),
    worktree: tree(),
    gateSteps: GATE_STEPS,
    gateRequest: Effect.succeed("{}"),
    fileReconciliationMode: "report_only" as const,
    phases: run.plan.phases,
    oracles: null,
    mainCheckout: run.world.repoRoot,
  });

  const resumeRequested = () =>
    dispatch(
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
        phaseFolderPath: phaseFolder(),
        phaseId: "phase-02",
      },
    );

  // The closing turn resumes the builder session X0: its lines land in X0's rollout.
  const answeringX0 = (): FakeBackendImpl => {
    const backend = makeFakeBackend().impl;
    backend.addResumeResponse({
      sessionId: "X0" as ClaudeSessionId,
      outputPath: "",
      finalText: answerText(),
    });
    backend.setOnResumeAgent(() =>
      appendFileSync(rolloutPath(world.home, "X0", x0Started()), '{"turn":"closing turn"}\n'),
    );
    return backend;
  };

  async function close(fake: FakeBackendImpl, variant: Variant = {}) {
    const { layer, telemetry } = layersOf(withStore(fake, world.home), variant);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* resumeRequested();
        return yield* Effect.either(closeStop(closeInput()));
      }).pipe(Effect.provide(layer)),
    );
    return { result, telemetry };
  }

  it("copies the builder's X0 with its closing turn into phase-02's folder", async () => {
    correct();

    const closed = success((await close(answeringX0())).result);

    expect(copiesIn(phaseFolder())).toEqual(["X0.jsonl"]);
    expect(readFileSync(copyOf(phaseFolder(), "X0"), "utf8")).toBe(
      '{"turn":"the builder"}\n{"turn":"closing turn"}\n',
    );
    const digest = digestOf(readFileSync(copyOf(phaseFolder(), "X0")));
    expect(transcriptsOf(phaseFolder())).toEqual([
      { sessionId: "X0", status: "captured", sha256: digest },
    ]);
    expect(closed.sessions).toEqual([
      expect.objectContaining({
        sessionId: "X0",
        origin: "builder",
        provider: "codex-cli",
        transcript: { status: "captured", sha256: digest },
      }),
    ]);
  });

  it("captures the builder of an unchanged held close too", async () => {
    putRollout(world.home, "X0", x0Started(), INVALID_UTF8);
    const backend = makeFakeBackend().impl;

    const closed = success((await close(backend)).result);

    expect(closed).toMatchObject({ cause: "held", outcome: "unchanged" });
    expect(backend.resumeCalls).toEqual([]);
    const copy = readFileSync(copyOf(phaseFolder(), "X0"));
    expect(Uint8Array.from(copy)).toEqual(INVALID_UTF8);
    expect(transcriptsOf(phaseFolder())).toEqual([
      { sessionId: "X0", status: "captured", sha256: digestOf(copy) },
    ]);
  });

  it("records a missing builder transcript and still lands the review commit", async () => {
    rmSync(rolloutPath(world.home, "X0", x0Started()));
    correct();
    const phaseCommit = heldGit(tree(), "rev-parse", "HEAD");
    // The closing turn writes nothing to the store here, as when the store is gone.
    const backend = answeringX0();
    backend.setOnResumeAgent(() => undefined);

    const closed = success((await close(backend)).result);

    expect(closed).toMatchObject({ cause: "held", outcome: "corrected", phaseCommit });
    expect(heldGit(tree(), "rev-parse", "HEAD^")).toBe(phaseCommit);
    expect(copiesIn(phaseFolder())).toEqual([]);
    expect(transcriptsOf(phaseFolder())).toMatchObject([
      { sessionId: "X0", status: "missing", reason: "not-found" },
    ]);
  });

  it("puts no path under interactive-transcripts/ on any branch", async () => {
    correct();

    success((await close(answeringX0())).result);

    expect(copiesIn(phaseFolder())).toEqual(["X0.jsonl"]);
    expectNoBranchHoldsTranscripts(run.world.repoRoot);
    expect(heldGit(tree(), "status", "--porcelain")).toBe("");
  });
});
