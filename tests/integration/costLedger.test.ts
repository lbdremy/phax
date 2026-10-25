// The cost ledger at run time (spec cost-ledger §8): a run's Claude
// invocations each append one entry to <run folder>/cost-ledger.json when they
// end, a codex-routed phase writes none, a phase turn stopped by a usage limit
// leaves a partial entry, a damaged ledger is left as it is without changing
// the invocation's outcome, and `phax archive` carries the ledger unchanged.
// Every run uses a temporary state root and a fake backend that writes
// made-up streams to the invocation's outputJsonlPath; no real provider is
// spawned and ~/.phax is never read.
import { Effect, Either, Exit, Fiber, Layer } from "effect";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { archive } from "../../src/app/archive.js";
import {
  activeInvocationCost,
  COST_LEDGER_FILE,
  withInvocationCost,
} from "../../src/app/costLedger.js";
import { syncRecordInterruptedInvocation } from "../../src/cli/interruptHandler.js";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId, type RunId } from "../../src/domain/branded.js";
import { UsageLimitError } from "../../src/domain/errors.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import type { AgentRunOptions } from "../../src/ports/backend.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { CostLedgerEntry } from "../../src/schemas/costLedger.js";
import { readCostLedgerFile, readPhaxPlanFile } from "../../src/schemas/persisted.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import { planMdFor } from "../helpers/planMarkdown.js";

const HANDOFF_CONTENT = [
  "## What was delivered",
  "Phase completed successfully.",
  "## Key decisions and why",
  "No major decisions.",
  "## Exact locations (file paths and exported names)",
  "No new exports.",
  "## What the next phase needs to know",
  "Ready to proceed.",
].join("\n");

const NAMESPACE = "test-project";
const SHORT_NAME = "ledger-run";
const shortName = Either.getOrThrow(decodeShortName(SHORT_NAME));
const GATE = "node scripts/example-check.mjs";

function rawPlan(phase02Model: string) {
  return {
    version: 1,
    run: {
      shortName: SHORT_NAME,
      title: "Ledger Run",
      branch: "ai/ledger-run",
      requiredCommands: [],
    },
    phases: [
      {
        id: "phase-01",
        title: "First Phase",
        model: "claude-opus-5-5",
        effort: "low" as const,
        planMarkdownAnchor: "#phase-01-first",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
      },
      {
        id: "phase-02",
        title: "Second Phase",
        model: phase02Model,
        effort: "low" as const,
        planMarkdownAnchor: "#phase-02-second",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        commit: { subject: "ai(phase-02): do more", body: "Does more." },
      },
    ],
  };
}

function makeConfig(stateRoot: string, complianceReview: boolean): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: stateRoot },
      gateProfiles: {
        full: [{ command: GATE, surface: "local", firing: "every-phase", output: "log" }],
      },
      commands: { setup: ["true"], cleanup: ["true"] },
    },
    stateRoot,
    namespace: NAMESPACE,
    repoRoot: stateRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" as const },
      autoPush: false,
    },
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    publish: resolvePublishConfig(undefined),
    complianceReview: complianceReview
      ? { enabled: true, model: "claude-sonnet-5", effort: "medium" }
      : resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
  };
}

const codexEnabled: ProviderConfig = {
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!, enabled: true },
  },
};

// ── made-up streams

const line = (event: object): string => JSON.stringify(event);

/** The stream path phax handed the invocation; every Claude invocation of a run gets one. */
function streamOf(options: AgentRunOptions): string {
  if (options.outputJsonlPath === undefined) throw new Error("invocation without a stream path");
  return options.outputJsonlPath;
}

function writeStream(path: string, events: ReadonlyArray<object>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map(line).join("\n") + "\n");
}

const init = (sessionId: string) => ({
  type: "system",
  subtype: "init",
  session_id: sessionId,
  claude_code_version: "2.1.280",
});

// `example-model` has no list price: a stream's running cost stays $0, so a
// sample's runCostUsd is exactly the earlier entries' sum.
const assistant = (id: string, outputTokens: number) => ({
  type: "assistant",
  message: {
    id,
    model: "example-model",
    usage: { input_tokens: 2, output_tokens: outputTokens, cache_read_input_tokens: 100 },
  },
});

const rateLimit = (fiveHour: number) => ({
  type: "rate_limit_event",
  rate_limit_info: {
    status: "allowed",
    unifiedWindows: {
      five_hour: { utilization: fiveHour, resetsAt: 1792069800 },
      seven_day: { utilization: 0.1, resetsAt: 1792335600 },
    },
  },
});

// Claude Code 2.1.280 reports a resumed session cumulatively: `costUsd` is the
// session's total so far.
const result = (sessionId: string, costUsd: number, outputTokens: number) => ({
  type: "result",
  subtype: "success",
  session_id: sessionId,
  duration_ms: 1500,
  modelUsage: {
    "example-model": {
      inputTokens: 10,
      outputTokens,
      cacheReadInputTokens: 1000,
      cacheCreationInputTokens: 50,
      costUSD: costUsd,
    },
  },
});

/** The session total each invocation reports, by phase and stream. */
const REPORTED: Record<string, Record<string, readonly [number, number]>> = {
  "phase-01": {
    "output.jsonl": [1, 1000],
    "fix-attempt-01.jsonl": [1.5, 1500],
    "handoff-generation.jsonl": [1.75, 1750],
  },
  "phase-02": {
    "output.jsonl": [2, 2000],
    "fix-attempt-01.jsonl": [2.5, 2500],
    "handoff-generation.jsonl": [2.75, 2750],
  },
};

function playStream(phaseFolderPath: string, outputJsonlPath: string): void {
  const phase = basename(phaseFolderPath);
  const stream = basename(outputJsonlPath);
  const reported = REPORTED[phase]?.[stream];
  if (reported === undefined) throw new Error(`no made-up stream for ${phase}/${stream}`);
  const sessionId = `session-${phase}`;
  writeStream(outputJsonlPath, [
    init(sessionId),
    assistant(`msg-${phase}-${stream}`, 10),
    rateLimit(0.25),
    result(sessionId, reported[0], reported[1]),
  ]);
}

async function readLedger(runPath: string): Promise<ReadonlyArray<CostLedgerEntry>> {
  const text = await readFile(join(runPath, COST_LEDGER_FILE), "utf8");
  const read = readCostLedgerFile(COST_LEDGER_FILE, JSON.parse(text));
  if (Either.isLeft(read)) throw new Error(read.left.message);
  return read.right.entries;
}

describe("cost ledger at run time", () => {
  let stateRoot: string;
  let runFolder: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-cost-ledger-"));
    runFolder = join(stateRoot, "runs", `${NAMESPACE}.${SHORT_NAME}`);
    for (const phase of ["phase-01", "phase-02"]) {
      const worktree = join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, phase);
      await mkdir(join(worktree, ".phax-context"), { recursive: true });
      await writeFile(join(worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(stateRoot, { recursive: true, force: true });
  });

  function worktreeOf(phase: string): string {
    return join(stateRoot, "worktrees", `${NAMESPACE}.${SHORT_NAME}`, phase);
  }

  function fakes(gateFailsOnce: boolean) {
    const git = makeFakeGit();
    git.impl.setRepoIsClean(true);
    git.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false, true);
    git.impl.enqueueWorktreeIsClean(worktreeOf("phase-02"), false);
    const shell = makeFakeShell();
    shell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    shell.impl.setResponse(GATE, { exitCode: 0, stdout: "ok", stderr: "" });
    shell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    shell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });
    const backend = makeFakeBackend();
    backend.impl.setOnRunAgent((_prompt, options) => {
      if (basename(streamOf(options)) === "compliance-review.session.jsonl") {
        writeStream(streamOf(options), [
          init("session-review"),
          rateLimit(0.3),
          result("session-review", 0.4, 400),
        ]);
        return;
      }
      // Each phase's first gate attempt fails, so the phase gets one fix attempt.
      if (gateFailsOnce) {
        shell.impl.setResponse(GATE, { exitCode: 1, stdout: "", stderr: "check failed" });
      }
      playStream(dirname(streamOf(options)), streamOf(options));
    });
    backend.impl.setOnResumeAgent((_sessionId, _prompt, options) => {
      if (basename(streamOf(options)).startsWith("fix-attempt-")) {
        shell.impl.setResponse(GATE, { exitCode: 0, stdout: "ok", stderr: "" });
      }
      playStream(dirname(streamOf(options)), streamOf(options));
    });
    for (const phase of ["phase-01", "phase-02"]) {
      backend.impl.addRunResponse({
        sessionId: `session-${phase}` as ClaudeSessionId,
        outputPath: "",
        finalText: "",
      });
    }
    backend.impl.addRunResponse({
      sessionId: "session-review" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    for (const phase of ["phase-01", "phase-02"]) {
      const resumes = gateFailsOnce ? 2 : 1;
      for (let i = 0; i < resumes; i++) {
        backend.impl.addResumeResponse({
          sessionId: `session-${phase}` as ClaudeSessionId,
          outputPath: "",
          finalText: "",
        });
      }
    }
    const layers = Layer.mergeAll(
      git.layer,
      shell.layer,
      backend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
      makeFakeGitHub().layer,
    );
    return { git, shell, backend, layers };
  }

  async function runPlan(opts: {
    readonly phase02Model: string;
    readonly complianceReview: boolean;
    readonly gateFailsOnce: boolean;
    readonly providerConfig?: ProviderConfig;
    readonly prepare?: (backend: ReturnType<typeof makeFakeBackend>) => void;
  }) {
    const plan = Either.getOrThrow(
      readPhaxPlanFile("phax-plan.json", rawPlan(opts.phase02Model)),
    ).plan;
    const config = makeConfig(stateRoot, opts.complianceReview);
    const { backend, layers } = fakes(opts.gateFailsOnce);
    opts.prepare?.(backend);
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMdFor(plan), plan, config).pipe(Effect.provide(layers)),
    );
    const outcome = await Effect.runPromise(
      Effect.either(
        executePlan({
          phaxVersion: "0.0.0-test",
          shortName,
          namespace: NAMESPACE,
          plan,
          planMd: planMdFor(plan),
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
          ...(opts.providerConfig !== undefined ? { providerConfig: opts.providerConfig } : {}),
        }).pipe(Effect.provide(layers)),
      ),
    );
    return { runPath, outcome, backend };
  }

  it("holds one entry per phase turn, fix attempt, handoff and compliance review of a completed run", async () => {
    const { runPath, outcome } = await runPlan({
      phase02Model: "claude-opus-5-5",
      complianceReview: true,
      gateFailsOnce: true,
    });
    expect(Either.isRight(outcome)).toBe(true);
    expect(runPath).toBe(runFolder);

    const entries = await readLedger(runPath);
    expect(entries.map((entry) => [entry.phase, entry.role])).toEqual([
      ["phase-01", "phase"],
      ["phase-01", "fix"],
      ["phase-01", "handoff"],
      ["phase-02", "phase"],
      ["phase-02", "fix"],
      ["phase-02", "handoff"],
      [null, "compliance"],
    ]);
    for (const entry of entries) {
      expect(entry.provider).toBe("claude-code");
      expect(entry.completeness).toBe("complete");
      expect(entry.agentMs).toBe(1500);
      expect(Object.keys(entry.models)).toEqual(["example-model"]);
      expect(entry.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    }
    expect(entries.map((entry) => entry.sessionId)).toEqual([
      "session-phase-01",
      "session-phase-01",
      "session-phase-01",
      "session-phase-02",
      "session-phase-02",
      "session-phase-02",
      "session-review",
    ]);
    // Each resume's cumulative report is corrected to its own cost.
    expect(entries.map((entry) => entry.costUsd)).toEqual([1, 0.5, 0.25, 2, 0.5, 0.25, 0.4]);
    expect(entries.map((entry) => entry.models["example-model"]?.outputTokens)).toEqual([
      1000, 500, 250, 2000, 500, 250, 400,
    ]);
    // A sample's run cost is the earlier entries' sum (the stream's messages are unpriced).
    expect(entries.map((entry) => entry.rateLimitSamples.map((s) => s.runCostUsd))).toEqual([
      [0, 0],
      [1, 1],
      [1.5, 1.5],
      [1.75, 1.75],
      [3.75, 3.75],
      [4.25, 4.25],
      [4.5, 4.5],
    ]);
    expect(entries[0]?.rateLimitSamples).toEqual([
      { window: "five-hour", utilization: 25, resetsAt: "2026-10-15T13:10:00Z", runCostUsd: 0 },
      { window: "seven-day", utilization: 10, resetsAt: "2026-10-18T15:00:00Z", runCostUsd: 0 },
    ]);

    const raw = await readFile(join(runPath, COST_LEDGER_FILE), "utf8");
    expect(Object.keys(JSON.parse(raw) as object)[0]).toBe("$schema");
  });

  it("writes no entry for a phase routed to codex-cli", async () => {
    const { runPath, outcome, backend } = await runPlan({
      phase02Model: "gpt-6-sol",
      complianceReview: false,
      gateFailsOnce: false,
      providerConfig: codexEnabled,
    });
    expect(Either.isRight(outcome)).toBe(true);
    expect(backend.impl.runCalls.map((call) => call.options.provider)).toEqual([
      "claude-code",
      "codex-cli",
    ]);
    // The codex phase's streams exist, Claude-shaped even, and are still not recorded.
    expect(backend.impl.runCalls[1]?.options.outputJsonlPath).toBe(
      join(runPath, "phase-02", "output.jsonl"),
    );

    const entries = await readLedger(runPath);
    expect(entries.map((entry) => [entry.phase, entry.role])).toEqual([
      ["phase-01", "phase"],
      ["phase-01", "handoff"],
    ]);
  });

  it("leaves a partial entry for a phase turn stopped by a usage limit before its result", async () => {
    const { runPath, outcome } = await runPlan({
      phase02Model: "claude-opus-5-5",
      complianceReview: false,
      gateFailsOnce: false,
      prepare: (backend) => {
        backend.impl.failRunWithRateLimit(0, { kind: "usage_limit" });
        backend.impl.setOnRunAgent((_prompt, options) => {
          writeStream(streamOf(options), [
            init("session-limited"),
            assistant("msg-01", 300),
            assistant("msg-01", 400),
            assistant("msg-02", 50),
            rateLimit(1),
          ]);
        });
      },
    });
    expect(Either.isLeft(outcome) && outcome.left instanceof UsageLimitError).toBe(true);
    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("rate_limited");

    const entries = await readLedger(runPath);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.role).toBe("phase");
    expect(entry?.phase).toBe("phase-01");
    expect(entry?.completeness).toBe("partial");
    expect(entry?.sessionId).toBe("session-limited");
    expect(entry?.models).toEqual({
      "example-model": {
        inputTokens: 4,
        outputTokens: 450,
        cacheReadTokens: 200,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
    });
    expect(entry?.costUsd).toBe(0);
    expect(entry?.agentMs).toBeGreaterThanOrEqual(0);
    expect(entry?.rateLimitSamples.map((sample) => sample.utilization)).toEqual([100, 10]);
  });

  it("moves the ledger byte for byte into the archived run folder", async () => {
    const { runPath, outcome } = await runPlan({
      phase02Model: "claude-opus-5-5",
      complianceReview: false,
      gateFailsOnce: false,
    });
    expect(Either.isRight(outcome)).toBe(true);
    const before = await readFile(join(runPath, COST_LEDGER_FILE));

    await Effect.runPromise(
      archive(NAMESPACE, shortName, stateRoot, stateRoot, { force: true }).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeFakeGit().layer,
            makeFakeShell().layer,
            makeFakeLock().layer,
            NodeFileSystemLayer,
            NoopSystemTelemetryLayer,
          ),
        ),
      ),
    );

    const archived = join(stateRoot, "archive", `${NAMESPACE}.${SHORT_NAME}`, "runs");
    expect(await readFile(join(archived, COST_LEDGER_FILE))).toEqual(before);
    await expect(readFile(join(runPath, COST_LEDGER_FILE))).rejects.toThrow();
  });
});

describe("withInvocationCost", () => {
  let runPath: string;

  beforeEach(async () => {
    runPath = await mkdtemp(join(tmpdir(), "phax-cost-ledger-run-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(runPath, { recursive: true, force: true });
  });

  const streamPath = () => join(runPath, "phase-01", "output.jsonl");

  function wrapped<A, E>(invocation: Effect.Effect<A, E>) {
    return withInvocationCost(invocation, {
      role: "phase",
      phase: "phase-01",
      runId: "example-run" as RunId,
      runPath,
      provider: "claude-code",
      streamPath: streamPath(),
    });
  }

  it("records a failed invocation and keeps its failure", async () => {
    writeStream(streamPath(), [init("session-failed"), result("session-failed", 0.2, 20)]);
    const outcome = await Effect.runPromise(
      Effect.either(
        wrapped(Effect.fail("agent crashed")).pipe(
          Effect.provide(Layer.merge(NodeFileSystemLayer, NoopSystemTelemetryLayer)),
        ),
      ),
    );
    expect(outcome).toEqual(Either.left("agent crashed"));
    const entries = await readLedger(runPath);
    expect(entries.map((entry) => entry.costUsd)).toEqual([0.2]);
  });

  it("records nothing for an absent stream or a stream that never started", async () => {
    const layers = Layer.merge(NodeFileSystemLayer, NoopSystemTelemetryLayer);
    await Effect.runPromise(wrapped(Effect.succeed(1)).pipe(Effect.provide(layers)));
    writeStream(streamPath(), [{ type: "user" }]);
    await Effect.runPromise(wrapped(Effect.succeed(2)).pipe(Effect.provide(layers)));
    await expect(readFile(join(runPath, COST_LEDGER_FILE))).rejects.toThrow();
  });

  it("leaves a damaged ledger as it is, warns, reports to telemetry, and keeps the invocation's result", async () => {
    writeStream(streamPath(), [init("session-ok"), result("session-ok", 0.2, 20)]);
    const damaged =
      '{"$schema":"https://docs.phax.run/schemas/cost-ledger/0.25.0.json","entries":7}';
    await writeFile(join(runPath, COST_LEDGER_FILE), damaged);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const telemetry = makeFakeSystemTelemetry();

    const value = await Effect.runPromise(
      wrapped(Effect.succeed("phase done")).pipe(
        Effect.provide(Layer.merge(NodeFileSystemLayer, telemetry.layer)),
      ),
    );

    expect(value).toBe("phase done");
    expect(await readFile(join(runPath, COST_LEDGER_FILE), "utf8")).toBe(damaged);
    const warning = stderr.mock.calls.map(([text]) => String(text)).join("");
    expect(warning).toContain('[phax] Warning: run "example-run", phase "phase-01" — phase');
    expect(warning).toContain("cost ledger entry");
    const errors = telemetry.impl.errors();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.type).toBe("cost_ledger.record_failed");
    expect(errors[0]?.operationId).toBe("phase-01");
    expect(errors[0]?.operation).toBe("cost-ledger.phase");
  });

  it("does nothing for a provider other than Claude Code", async () => {
    writeStream(streamPath(), [init("session-codex"), result("session-codex", 0.2, 20)]);
    await Effect.runPromise(
      withInvocationCost(Effect.succeed(1), {
        role: "fix",
        phase: "phase-01",
        runId: "example-run" as RunId,
        runPath,
        provider: "mistral-vibe",
        streamPath: streamPath(),
      }).pipe(Effect.provide(Layer.merge(NodeFileSystemLayer, NoopSystemTelemetryLayer))),
    );
    await expect(readFile(join(runPath, COST_LEDGER_FILE))).rejects.toThrow();
  });

  it("records an interrupted invocation", async () => {
    writeStream(streamPath(), [init("session-cut"), assistant("msg-01", 5)]);
    const outcome = await Effect.runPromiseExit(
      wrapped(Effect.interrupt).pipe(
        Effect.provide(Layer.merge(NodeFileSystemLayer, NoopSystemTelemetryLayer)),
      ),
    );
    expect(Exit.isInterrupted(outcome)).toBe(true);
    const entries = await readLedger(runPath);
    expect(entries.map((entry) => entry.completeness)).toEqual(["partial"]);
  });

  it("lets the signal handler, which exits before onExit runs, record the running invocation", async () => {
    writeStream(streamPath(), [init("session-signal"), assistant("msg-01", 5)]);
    const fiber = Effect.runFork(
      wrapped(Effect.never).pipe(
        Effect.provide(Layer.merge(NodeFileSystemLayer, NoopSystemTelemetryLayer)),
      ),
    );
    while (activeInvocationCost() === undefined) await new Promise((r) => setTimeout(r, 1));
    expect(activeInvocationCost()?.opts.streamPath).toBe(streamPath());

    syncRecordInterruptedInvocation();

    const entries = await readLedger(runPath);
    expect(entries.map((entry) => [entry.sessionId, entry.completeness])).toEqual([
      ["session-signal", "partial"],
    ]);
    expect(entries[0]?.models["example-model"]?.outputTokens).toBe(5);
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(activeInvocationCost()).toBeUndefined();
  });
});
