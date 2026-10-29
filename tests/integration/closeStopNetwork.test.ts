import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeStop } from "../../src/app/closeStop.js";
import { dispatch } from "../../src/app/dispatcher.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import type { PhaseId, RunId } from "../../src/domain/branded.js";
import { StopCloseRefusedError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend } from "../../src/ports/backend.js";
import { Git } from "../../src/ports/git.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer, type SystemTelemetry } from "../../src/ports/systemTelemetry.js";
import { makeInMemoryTelemetryLayer } from "../../src/infra/telemetry/inMemory.js";
import { resumeRetryCommand } from "../../src/cli/commands/sessionFailureOutput.js";
import { renderStopCloseRefusal } from "../../src/cli/commands/stopOutput.js";
import { decodeReviewStopV0_26_0 } from "../../src/schemas/history/review-stop/0.26.0.js";
import { decodeRunListV0_26_0 } from "../../src/schemas/history/run-list/0.26.0.js";
import { currentSchemaUrl, readReviewStopFile } from "../../src/schemas/persisted.js";
import { decodeReviewStopFile } from "../../src/schemas/reviewStop.js";
import { decodeRunListFile } from "../../src/schemas/runList.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import {
  createWorld,
  readJson,
  resolvedConfig,
  stopRun,
  type StoppedRun,
  type World,
} from "../helpers/stoppedRunFixture.js";

// The made-up invoice-export run stopped at its interactive phase-03, closed
// through `closeStop` with a closing turn that loses the network: the close is
// refused with result `network` (exit 14) and the run stays awaiting review.

const sessionLayer = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../../src/app/loadConfig.js", () => ({ loadConfig: vi.fn() }));
vi.mock("../../src/infra/session.js", () => ({
  makeNodeSessionLayer: () => sessionLayer.current,
}));
// No test reads ~/.phax: providers.json is the built-in catalog.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const { Effect: E } = await import("effect");
  const { DEFAULT_PROVIDER_CONFIG: defaults } =
    await import("../../src/domain/routing/defaults.js");
  return { ...original, loadProviderConfig: () => E.succeed(defaults) };
});

const PHASE_03: PhaxPlanPhase = {
  id: "phase-03",
  title: "Review the export record",
  model: "claude-sonnet-5-5",
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

const GATE_STEPS: readonly GateStep[] = [
  { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
];

const PROVIDER_MESSAGE = "getaddrinfo ENOTFOUND api.anthropic.com";

let world: World;

beforeEach(async () => {
  world = createWorld();
  const { loadConfig } = await import("../../src/app/loadConfig.js");
  vi.mocked(loadConfig).mockReturnValue(Either.right(resolvedConfig(world)));
});

afterEach(() => {
  vi.clearAllMocks();
  world.cleanup();
});

const realGit = Effect.runSync(Effect.provide(Git, NodeGitLayer));

const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));

// The `pnpm typecheck` gate step passes; git runs for real.
const passingShell = Layer.succeed(Shell, {
  run: (options) =>
    options.command.join(" ") === "pnpm typecheck"
      ? Effect.succeed({ exitCode: 0, stdout: "", stderr: "", stdoutEncoding: "utf8" as const })
      : realShell.run(options),
});

const closeInput = (run: StoppedRun) => ({
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

async function closeWithNetworkFailure(
  run: StoppedRun,
  telemetry: Layer.Layer<SystemTelemetry> = NoopSystemTelemetryLayer,
) {
  const backend = makeFakeBackend().impl;
  backend.failNextResumeWith(
    {
      provider: "claude-code",
      kind: "network",
      message: PROVIDER_MESSAGE,
      sessionId: "X1",
      resetAt: null,
    },
    {
      agentErrorLog: join(run.phaseFolder, "agent-error.log"),
      transcript: join(run.phaseFolder, "closing-turn-01.jsonl"),
    },
  );
  const program = Effect.gen(function* () {
    yield* dispatch(
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
    return yield* Effect.either(closeStop(closeInput(run)));
  });
  return Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Backend, backend),
          NodeFileSystemLayer,
          Layer.succeed(Git, realGit),
          passingShell,
          telemetry,
        ),
      ),
    ),
  );
}

describe("a closing turn that loses the network", () => {
  it("is refused with exit 14, keeps the run awaiting review and records lastClose network", async () => {
    const run = await stopRun(world);
    writeFileSync(join(run.worktree, "src/invoiceRow.ts"), "export const header = 'x';\n");

    const result = await closeWithNetworkFailure(run);

    if (Either.isRight(result)) throw new Error("the close was not refused");
    expect(result.left).toBeInstanceOf(StopCloseRefusedError);
    const error = result.left as StopCloseRefusedError;
    expect(exitCodeForError(error)).toBe(14);
    expect(error.lastClose).toMatchObject({
      result: "network",
      exitCode: 14,
      detail: expect.stringContaining(PROVIDER_MESSAGE),
    });

    expect(readJson(join(run.runPath, "run-status.json"))["state"]).toBe("awaiting_review");
    expect(readJson(join(run.phaseFolder, "status.json"))["state"]).toBe("awaiting_review");
    const stop = readJson(join(run.runPath, "review-stop.json"));
    expect(stop["$schema"]).toBe("https://docs.phax.run/schemas/review-stop/0.30.0.json");
    expect(stop["lastClose"]).toEqual({
      result: "network",
      at: expect.any(String),
      exitCode: 14,
      detail: expect.stringContaining(PROVIDER_MESSAGE),
    });
    expect(Object.keys(stop["lastClose"] as object)).not.toContain("step");
    expect(Either.isRight(decodeReviewStopFile(stop))).toBe(true);
  });
});

describe("the terminal after a closing turn that lost the network", () => {
  it("prints the failed session, its files and the retry, then the refusal", async () => {
    const run = await stopRun(world);
    writeFileSync(join(run.worktree, "src/invoiceRow.ts"), "export const header = 'x';\n");

    const result = await closeWithNetworkFailure(run);

    if (Either.isRight(result)) throw new Error("the close was not refused");
    const error = result.left as StopCloseRefusedError;
    const retry = resumeRetryCommand(run.shortName, "claude-code,codex-cli");
    expect(renderStopCloseRefusal(error, retry)).toEqual([
      `✗ claude-code session failed (network): ${PROVIDER_MESSAGE}`,
      "  session: X1",
      `  See ${join(run.phaseFolder, "agent-error.log")} and closing-turn-01.jsonl`,
      `  Retry once the network is back: phax resume ${run.shortName} --yes --provider-priority claude-code,codex-cli`,
      expect.stringMatching(
        /^✗ phase-03 stays awaiting review: the closing turn could not reach the provider/,
      ),
    ]);
  });

  it("records one adapter.agent_failed report for the failed closing turn", async () => {
    const run = await stopRun(world);
    writeFileSync(join(run.worktree, "src/invoiceRow.ts"), "export const header = 'x';\n");
    const { impl, layer } = makeInMemoryTelemetryLayer();

    await closeWithNetworkFailure(run, layer);

    const reports = impl.errors().filter((e) => e.type === "adapter.agent_failed");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ actual: "network" });
  });
});

// The stop the real stop wrote, with no lastClose.
const stopOf = async (run: StoppedRun): Promise<Record<string, unknown>> => {
  const stop = readJson(join(run.runPath, "review-stop.json"));
  return { ...stop, lastClose: null };
};

describe("review-stop and run-list documents at 0.26.0 and 0.30.0", () => {
  it("reads a review-stop.json stamped 0.26.0 through the frozen decoder, as the current shape", async () => {
    const run = await stopRun(world);
    const stop: Record<string, unknown> = {
      ...(await stopOf(run)),
      $schema: "https://docs.phax.run/schemas/review-stop/0.26.0.json",
    };
    const path = join(run.runPath, "review-stop.json");
    writeFileSync(path, JSON.stringify(stop));

    expect(Either.isRight(decodeReviewStopV0_26_0(stop))).toBe(true);
    const read = readReviewStopFile(path, JSON.parse(readFileSync(path, "utf8")));
    if (Either.isLeft(read)) throw new Error(String(read.left));
    expect(read.right).not.toHaveProperty("$schema");
    expect(read.right.lastClose).toBeNull();
    expect(read.right.run).toBe(stop["run"]);
  });

  it("refuses a network close in a stop stamped 0.26.0", async () => {
    const run = await stopRun(world);
    const stop = {
      ...(await stopOf(run)),
      $schema: "https://docs.phax.run/schemas/review-stop/0.26.0.json",
      lastClose: { result: "network", at: "2026-10-28T10:00:00.000Z", exitCode: 14, detail: "x" },
    };
    expect(Either.isLeft(decodeReviewStopV0_26_0(stop))).toBe(true);
  });

  it("round-trips a 0.30.0 network close through the current decoder", async () => {
    const run = await stopRun(world);
    const stop = {
      ...(await stopOf(run)),
      $schema: currentSchemaUrl("review-stop"),
      lastClose: {
        result: "network",
        at: "2026-10-28T10:00:00.000Z",
        exitCode: 14,
        detail: PROVIDER_MESSAGE,
      },
    };
    const decoded = decodeReviewStopFile(stop);
    if (Either.isLeft(decoded)) throw new Error(String(decoded.left));
    expect(decoded.right.lastClose).toEqual(stop.lastClose);
    const withStep = { ...stop, lastClose: { ...stop.lastClose, step: "closing-turn" } };
    expect(Either.isLeft(decodeReviewStopFile(withStep))).toBe(true);
  });

  it("reads a run list at 0.26.0 and a 0.30.0 one embedding a network close", async () => {
    const run = await stopRun(world);
    const base = await stopOf(run);
    const row = (stop: unknown, stamp: string) => ({
      $schema: `https://docs.phax.run/schemas/run-list/${stamp}.json`,
      runs: [
        {
          qualifiedName: `example.${run.shortName}`,
          namespace: "example",
          shortName: run.shortName,
          state: "awaiting_review",
          branch: "phax/x",
          currentPhase: "3/5",
          gateProfile: "standard",
          updatedAt: "2026-10-28 10:00",
          lockState: "none",
          recordsPending: null,
          archivePath: null,
          stop,
        },
      ],
    });
    const old = row(
      { ...base, $schema: "https://docs.phax.run/schemas/review-stop/0.26.0.json" },
      "0.26.0",
    );
    expect(Either.isRight(decodeRunListV0_26_0(old))).toBe(true);

    const current = row(
      {
        ...base,
        $schema: currentSchemaUrl("review-stop"),
        lastClose: { result: "network", at: "2026-10-28T10:00:00.000Z", exitCode: 14, detail: "x" },
      },
      "0.30.0",
    );
    expect(Either.isRight(decodeRunListFile(current))).toBe(true);
    expect(Either.isLeft(decodeRunListV0_26_0(current))).toBe(true);
  });
});
