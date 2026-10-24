import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHeldReviewCommitBody } from "../../src/app/commit.js";
import { closeStop, type CloseReport } from "../../src/app/closeStop.js";
import { dispatch } from "../../src/app/dispatcher.js";
import type { PhaseId, RunId } from "../../src/domain/branded.js";
import { StopCloseRefusedError } from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { PERSON_HANDOFF_PATH } from "../../src/domain/interactive/worktreeChange.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend } from "../../src/ports/backend.js";
import { Git } from "../../src/ports/git.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { decodePhaseStatusFile } from "../../src/schemas/status.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import {
  SHORT,
  createHeldWorld,
  gitIn,
  readJson,
  startHeldRun,
  worktreeOf,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";
import { removeTempDir } from "../helpers/tempGit.js";

// Who closed the stop: the made-up invoice-export run held at phase-02, closed
// through `closeStop`. The closer is the main checkout's git identity (Ada
// Example), read through the Git port, whoever committed or authored the work.

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

const ADA = { name: "Ada Example", email: "ada@example.test" };

const GATE_STEPS: readonly GateStep[] = [
  { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
  { command: "pnpm test", surface: "local", firing: "every-phase", output: "log" },
];

const PERSON_HANDOFF = [
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
].join("\n");

let world: HeldWorld;
let run: HeldRun;
let gitConfigDir: string;

beforeEach(async () => {
  world = createHeldWorld();
  gitConfigDir = mkdtempSync(join(tmpdir(), "phax-closed-by-gitconfig-"));
  const globalConfig = join(gitConfigDir, "gitconfig");
  writeFileSync(globalConfig, "");
  vi.stubEnv("HOME", world.home);
  vi.stubEnv("XDG_CONFIG_HOME", join(gitConfigDir, "xdg"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  for (const key of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL"]) vi.stubEnv(key, undefined);
  // The work is committed by someone else: the closer is never read from a commit.
  vi.stubEnv("GIT_COMMITTER_NAME", "Grace Hopper");
  vi.stubEnv("GIT_COMMITTER_EMAIL", "grace@example.test");
  const started = await startHeldRun(world, { selection: "listed", phases: ["phase-02"] });
  run = started.run;
}, 30_000);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  world.cleanup();
  removeTempDir(gitConfigDir);
});

const phaseFolder = (): string => join(run.runPath, "phase-02");
const tree = (): string => worktreeOf(run, "phase-02");
const head = (): string => gitIn(tree(), "rev-parse", "HEAD");
const phase02 = () => run.plan.phases[1]!;

const write = (path: string, content: string): void => {
  mkdirSync(dirname(join(tree(), path)), { recursive: true });
  writeFileSync(join(tree(), path), content);
};

const realGit = Effect.runSync(Effect.provide(Git, NodeGitLayer));
const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));

const passingGates = Layer.succeed(Shell, {
  run: (options) =>
    options.command[0] !== "pnpm"
      ? realShell.run(options)
      : Effect.succeed({ exitCode: 0, stdout: "", stderr: "", stdoutEncoding: "utf8" as const }),
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
    { runPath: run.runPath, shortName: SHORT, phaseFolderPath: phaseFolder(), phaseId: "phase-02" },
  );

const closeInput = () => ({
  runId: run.runId,
  shortName: SHORT,
  runPath: run.runPath,
  phase: phase02(),
  phaseFolder: phaseFolder(),
  worktree: tree(),
  gateSteps: GATE_STEPS,
  gateRequest: Effect.succeed("{}"),
  fileReconciliationMode: "report_only" as const,
  phases: run.plan.phases,
  oracles: null,
  mainCheckout: run.world.repoRoot,
});

async function close(options: { readonly resume?: boolean } = {}) {
  return Effect.runPromise(
    Effect.gen(function* () {
      if (options.resume !== false) yield* resumeRequested();
      return yield* Effect.either(closeStop(closeInput()));
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Backend, makeFakeBackend().impl),
          NodeFileSystemLayer,
          NodeGitLayer,
          passingGates,
          NoopSystemTelemetryLayer,
        ),
      ),
    ),
  );
}

const report = (result: Either.Either<CloseReport, unknown>): CloseReport => {
  if (Either.isLeft(result)) throw new Error(`close refused: ${String(result.left)}`);
  return result.right;
};

const statusStop = () => {
  const decoded = decodePhaseStatusFile(readJson(join(phaseFolder(), "status.json")));
  if (Either.isLeft(decoded)) throw new Error("status.json does not decode");
  return decoded.right.stop;
};

describe("who closed a held stop", () => {
  it("names the main checkout's identity on a held stop reviewed without change", async () => {
    const closed = report(await close());

    expect(closed).toMatchObject({ cause: "held", outcome: "unchanged", closedBy: ADA });
    expect(statusStop()).toEqual({
      cause: "held",
      status: "closed",
      outcome: "unchanged",
      closedBy: ADA,
    });
  });

  it("names the main checkout's identity on a corrected held stop, not the committer", async () => {
    write("src/invoiceRow.ts", "export const header = 'Invoice number';\n");
    write(PERSON_HANDOFF_PATH, PERSON_HANDOFF);

    const closed = report(await close());

    expect(closed).toMatchObject({ cause: "held", outcome: "corrected", closedBy: ADA });
    expect(gitIn(tree(), "log", "-1", "--format=%cn")).toBe("Grace Hopper");
    expect(statusStop()).toMatchObject({
      cause: "held",
      status: "closed",
      outcome: "corrected",
      reviewCommit: head(),
      closedBy: ADA,
    });
  });

  it("writes closedBy from the checkout's configuration when it finishes a landed review commit", async () => {
    const c2 = head();
    write("src/invoiceRow.ts", "export const header = 'Invoice number';\n");
    const landed = await Effect.runPromise(
      Effect.gen(function* () {
        yield* resumeRequested();
        const parkedPath = join(phaseFolder(), "review-stop.closing.json");
        writeFileSync(
          parkedPath,
          JSON.stringify({ ...readJson(parkedPath), closeBase: c2 }, null, 2),
        );
        writeFileSync(join(phaseFolder(), "correction-handoff.md"), PERSON_HANDOFF);
        const snapshot = yield* realGit.snapshotWorktree(tree());
        return yield* realGit.commitTree(
          tree(),
          snapshot,
          phase02().commit.subject,
          buildHeldReviewCommitBody({
            phase: phase02(),
            runId: run.runId,
            shortName: SHORT,
            worktreePath: tree(),
            gateLogPath: join(phaseFolder(), "review-gate", "checks-attempt-01.log"),
          }),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            NodeFileSystemLayer,
            NodeGitLayer,
            NodeShellLayer,
            NoopSystemTelemetryLayer,
          ),
        ),
      ),
    );

    const closed = report(await close({ resume: false }));

    expect(closed).toMatchObject({ handoffSource: "earlier-close", closedBy: ADA });
    expect(statusStop()).toMatchObject({
      outcome: "corrected",
      reviewCommit: landed,
      closedBy: ADA,
    });
  });

  it("refuses a close in a checkout with no identity, committing nothing and keeping the run waiting", async () => {
    const c2 = head();
    write("src/invoiceRow.ts", "export const header = 'Invoice number';\n");
    write(PERSON_HANDOFF_PATH, PERSON_HANDOFF);
    gitIn(run.world.repoRoot, "config", "--local", "--unset", "user.name");
    gitIn(run.world.repoRoot, "config", "--local", "--unset", "user.email");

    const result = await close();

    if (Either.isRight(result)) throw new Error("the close was not refused");
    expect(result.left).toBeInstanceOf(StopCloseRefusedError);
    const refused = result.left as StopCloseRefusedError;
    expect(refused.lastClose).toMatchObject({ result: "close-error", exitCode: 1, step: "commit" });
    expect(refused.lastClose).toMatchObject({
      detail: expect.stringContaining("set user.name and user.email"),
    });
    expect(head()).toBe(c2);
    expect(readJson(join(run.runPath, "run-status.json"))["state"]).toBe("awaiting_review");
    expect(
      (readJson(join(run.runPath, "review-stop.json"))["lastClose"] as Record<string, unknown>)[
        "result"
      ],
    ).toBe("close-error");
    expect(statusStop()).toEqual({ cause: "held", status: "waiting" });
  });
});
