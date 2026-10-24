import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listRecords } from "../../src/app/recordsList.js";
import { AwaitingReviewStopError } from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import {
  SHORT,
  createHeldWorld,
  gitIn,
  readPhaseStatus,
  readRunStatus,
  resumeHeldRun,
  startHeldRun,
  type HeldRun,
  type HeldWorld,
} from "../helpers/heldRunFixture.js";

// A declared close that fails past its commit, on the made-up invoice-export
// run stopped at its declared phase-03: the run is left for a resume to
// finish from the landed commit, as a held close is, and never fails.

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

const runFailedTraced = (run: HeldRun): boolean =>
  run.telemetry.impl
    .events()
    .some(
      (e) =>
        JSON.stringify(e).includes('"RunFailed"') ||
        JSON.stringify(e).includes("dispatch.RunFailed"),
    );

describe("a declared close that fails after its commit", { timeout: 60_000 }, () => {
  it("leaves the run resumable, never failed, and the next resume finishes it from the landed commit", async () => {
    const { run, result } = await startHeldRun(world, { selection: "none" }, { records: true });
    expect(Either.isLeft(result) && result.left instanceof AwaitingReviewStopError).toBe(true);
    const branch = `phax/${SHORT}--phase-03`;
    const base = gitIn(world.repoRoot, "rev-parse", branch);
    // The first write of phase-03's status as committed (StopCommitted's) fails once.
    const statusPath = join(run.runPath, "phase-03", "status.json");
    run.failWrite = (path, content) => {
      if (path !== statusPath || (JSON.parse(content) as { state?: string }).state !== "committed")
        return false;
      run.failWrite = undefined;
      return true;
    };

    const failed = await resumeHeldRun(run);

    expect(Either.isLeft(failed)).toBe(true);
    expect(run.failWrite).toBeUndefined();
    // The declared commit landed; the close's state event did not.
    const landed = gitIn(world.repoRoot, "rev-parse", branch);
    expect(landed).not.toBe(base);
    expect(gitIn(world.repoRoot, "log", "-1", "--format=%B", landed)).toContain(
      "Interactive-Phase: phase-03",
    );
    expect(readRunStatus(run)["state"]).not.toBe("failed");
    expect(readPhaseStatus(run, "phase-03")).toMatchObject({
      state: "awaiting_review",
      stop: { cause: "declared", status: "waiting" },
    });
    expect(runFailedTraced(run)).toBe(false);
    expect(await recordsOf(run, "phase-03")).toHaveLength(0);

    const finished = await resumeHeldRun(run);

    expect(Either.isRight(finished)).toBe(true);
    // Finished from the landed commit: no second commit on the phase branch.
    expect(gitIn(world.repoRoot, "rev-parse", branch)).toBe(landed);
    expect(readPhaseStatus(run, "phase-03")).toMatchObject({
      state: "cleaned_up",
      commitHash: landed,
      stop: { cause: "declared", status: "closed", outcome: "unchanged" },
    });
    expect(await recordsOf(run, "phase-03")).toHaveLength(1);
    expect(readRunStatus(run)["state"]).toBe("review_open");
  });
});
