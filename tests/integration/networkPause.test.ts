import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import {
  pausedHandoffFailure,
  pausedNetworkFailure,
  renderHandoffTurnPause,
  renderNetworkPause,
  renderSessionFailure,
} from "../../src/cli/commands/sessionFailureOutput.js";
import {
  decodeShortName,
  type ClaudeSessionId,
  type RunId,
  type ShortName,
} from "../../src/domain/branded.js";
import {
  AgentInvocationError,
  AgentSessionFailedError,
  HandoffPausedError,
} from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { sessionFailureError } from "../../src/domain/session/failureError.js";
import type { FailureKind, SessionFailure } from "../../src/domain/session/outcome.js";
import { makeNodeBackendLayer } from "../../src/infra/claudeCli.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { persistSessionId } from "../../src/infra/providers/sessionWriter.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend, type AgentRunOptions, type BackendOps } from "../../src/ports/backend.js";
import { Shell } from "../../src/ports/shell.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import { inspectResumeOnDisk } from "../helpers/inspectResume.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// A made-up two-phase run, end to end through executePlan: real git on a
// temporary repository, the real file system, a backend playing every provider
// turn (or the real node backend against a fake `claude`) and a shell whose
// `pnpm` steps are scripted. A provider session that loses the network pauses
// the run resumable; a handoff turn that fails is reported as that failure.

const NAMESPACE = "example";
const SHORT = "invoice-export";
const SESSION = "3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42";
const API_ERROR = "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";

const handoffOf = (phaseId: string): string =>
  [
    "## What was delivered",
    `- ${phaseId} delivered its file.`,
    "## Key decisions and why",
    "- None.",
    "## Exact locations (file paths and exported names)",
    `- src/${phaseId}.ts`,
    "## What the next phase needs to know",
    "- Ready to proceed.",
    "",
  ].join("\n");

// ── The world ──────────────────────────────────────────────────────────────

interface World {
  readonly root: string;
  readonly repoRoot: string;
  readonly stateRoot: string;
}

let world: World;

beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-network-pause-test-")));
  const repoRoot = join(root, "repo");
  const stateRoot = join(root, "state");
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  vi.stubEnv("HOME", join(root, "home"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(repoRoot);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  writeFileSync(join(repoRoot, ".gitignore"), ".phax-context/\n.setup-marker\n");
  writeFileSync(join(repoRoot, "src", "keep.ts"), "export const keep = 1;\n");
  git("add", "-A");
  git("commit", "-m", "chore: start");
  world = { root, repoRoot, stateRoot };
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(world.root);
});

// ── The plan ───────────────────────────────────────────────────────────────

const PHASES = ["phase-01", "phase-02"] as const;

function planOf(): { plan: PhaxPlan; planMd: string } {
  const plan = {
    run: {
      shortName: SHORT,
      title: "Invoice export",
      branch: `phax/${SHORT}`,
      requiredCommands: [],
    },
    phases: PHASES.map(
      (id, i): PhaxPlanPhase => ({
        id,
        title: `Export step ${i + 1}`,
        model: "claude-sonnet-5-5",
        effort: "medium",
        planMarkdownAnchor: `#${id}`,
        plannedFilesToCreate: [`src/${id}.ts`],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        mode: "headless",
        oracle: null,
        testLines: [],
        commit: { subject: `feat(export): step ${i + 1}`, body: "Made-up body." },
      }),
    ) as unknown as PhaxPlan["phases"],
  } satisfies PhaxPlan;
  const planMd = [
    "# Invoice export",
    "",
    "## Required commands",
    "",
    "- (none)",
    "",
    ...plan.phases.flatMap((phase) => [
      `## ${phase.id} — ${phase.title} {#${phase.id}}`,
      "",
      `**Recommended model:** ${phase.model}`,
      `**Recommended effort:** ${phase.effort}`,
      "",
      "### Detailed instructions",
      "",
      `Write src/${phase.id}.ts.`,
      "",
    ]),
  ].join("\n");
  return { plan, planMd };
}

function configOf(): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: world.stateRoot },
      gateProfiles: {
        standard: [
          { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
        ],
      },
      commands: { setup: ["touch .setup-marker"], cleanup: ["pnpm cleanup"] },
    },
    stateRoot: world.stateRoot,
    namespace: NAMESPACE,
    repoRoot: world.repoRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
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
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
  } as ResolvedConfig;
}

// ── The provider and the shell ─────────────────────────────────────────────

type Turn = { readonly kind: "run" | "resume"; readonly phase: string };

const phaseOf = (options: AgentRunOptions): string =>
  basename(options.phaseFolderPath ?? options.cwd);

const unused = () => Effect.fail(new AgentInvocationError({ message: "not played by this test" }));

const failureOf = (kind: FailureKind): SessionFailure => ({
  provider: "claude-code",
  kind,
  message: kind === "network" ? API_ERROR : "error_during_execution",
  sessionId: SESSION,
  resetAt: null,
});

/** Where the provider fails, once: the phase's work turn, or its handoff turn. */
interface Outage {
  readonly phase: string;
  readonly turn: "run" | "resume";
  readonly kind: FailureKind;
}

// A headless phase writes its planned file, and its handoff when phax resumes
// it for one. The outage fails its turn once, then is over.
function playingBackend(turns: Turn[], outage: { current: Outage | null }): BackendOps {
  const fails = (kind: "run" | "resume", phase: string) => {
    const current = outage.current;
    if (current === null || current.turn !== kind || current.phase !== phase) return null;
    outage.current = null;
    const files = {
      agentErrorLog: join(world.stateRoot, "agent-error.log"),
      transcript: null,
    };
    return Effect.fail(sessionFailureError(failureOf(current.kind), files));
  };
  return {
    runAgent: (_prompt, options) => {
      const phase = phaseOf(options);
      turns.push({ kind: "run", phase });
      const failed = fails("run", phase);
      if (failed !== null) return failed;
      // A provider records its session where a resume reads it.
      const sessionId = `sess-${phase}` as ClaudeSessionId;
      return Effect.promise(async () => {
        await persistSessionId(sessionId, options.phaseFolderPath as string);
        writeFileSync(
          join(options.cwd, "src", `${phase}.ts`),
          `export const ${phase.replace("-", "")} = 1;\n`,
        );
        return { sessionId, outputPath: "", finalText: "" };
      });
    },
    resumeAgentSession: (sessionId, _prompt, options) => {
      const phase = phaseOf(options);
      turns.push({ kind: "resume", phase });
      const failed = fails("resume", phase);
      if (failed !== null) return failed;
      return Effect.sync(() => {
        writeFileSync(join(options.cwd, ".phax-context", "phase-handoff.md"), handoffOf(phase));
        return { sessionId, outputPath: "", finalText: "" };
      });
    },
    complete: unused,
    probe: unused,
    captureTranscript: () =>
      Effect.succeed({ status: "missing", reason: "not-found", detail: "not played by this test" }),
  };
}

const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));

// `pnpm …` steps succeed; every other command runs for real.
const scriptedShell = Layer.succeed(Shell, {
  run: (options) =>
    options.command[0] !== "pnpm"
      ? realShell.run(options)
      : Effect.succeed({ exitCode: 0, stdout: "", stderr: "", stdoutEncoding: "utf8" as const }),
});

// ── Running ────────────────────────────────────────────────────────────────

interface Harness {
  readonly shortName: ShortName;
  readonly plan: PhaxPlan;
  readonly planMd: string;
  readonly runPath: string;
  readonly runId: RunId;
  readonly turns: Turn[];
  readonly outage: { current: Outage | null };
  readonly telemetry: ReturnType<typeof makeFakeSystemTelemetry>;
  readonly config: ResolvedConfig;
  backendLayer: Layer.Layer<Backend>;
}

async function startRun(
  outage: Outage | null,
  backendLayer?: Layer.Layer<Backend>,
): Promise<{ harness: Harness; result: Either.Either<unknown, unknown> }> {
  const shortName = Either.getOrThrow(decodeShortName(SHORT));
  const { plan, planMd } = planOf();
  const config = configOf();
  const turns: Turn[] = [];
  const state = { current: outage };
  const { runPath, runId } = await Effect.runPromise(
    createRunFolder(shortName, planMd, plan, config).pipe(Effect.provide(NodeFileSystemLayer)),
  );
  const harness: Harness = {
    shortName,
    plan,
    planMd,
    runPath,
    runId,
    turns,
    outage: state,
    telemetry: makeFakeSystemTelemetry(),
    config,
    backendLayer: backendLayer ?? Layer.succeed(Backend, playingBackend(turns, state)),
  };
  return { harness, result: await execute(harness, 0) };
}

function execute(harness: Harness, startIndex: number) {
  return Effect.runPromise(
    Effect.either(
      executePlan({
        phaxVersion: "0.0.0-test",
        shortName: harness.shortName,
        namespace: NAMESPACE,
        plan: harness.plan,
        planMd: harness.planMd,
        config: harness.config,
        gateProfileId: "standard",
        allowDirty: false,
        runPath: harness.runPath,
        runId: harness.runId,
        startIndex,
        routing: DEFAULT_MODEL_ROUTING,
        providerConfig: DEFAULT_PROVIDER_CONFIG,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            harness.backendLayer,
            NodeFileSystemLayer,
            NodeGitLayer,
            scriptedShell,
            harness.telemetry.layer,
            makeFakeGitHub().layer,
          ),
        ),
      ),
    ),
  );
}

/** `phax resume`: the start phase as the resume command decides it. */
async function resume(harness: Harness) {
  const decision = await inspectResumeOnDisk(NAMESPACE, harness.shortName, world.stateRoot);
  if (Either.isLeft(decision)) throw new Error(decision.left.message);
  return execute(harness, decision.right.nextPhaseIndex);
}

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const runStatus = (h: Harness) => readJson(join(h.runPath, "run-status.json"));
const phaseStatus = (h: Harness, phaseId: string) =>
  readJson(join(h.runPath, phaseId, "status.json"));

/** The events the run dispatched and the reducer handled, by name. */
const handledEvents = (h: Harness): string[] =>
  h.telemetry.impl
    .events()
    .filter((e) => e.type === "state.transition")
    .map((e) => ("event" in e ? e.event : ""));

function leftOf(result: Either.Either<unknown, unknown>): unknown {
  if (Either.isRight(result)) throw new Error("the run did not fail");
  return result.left;
}

// ── A phase whose session loses the network ────────────────────────────────

describe("a run whose phase session loses the network", { timeout: 60_000 }, () => {
  const outage: Outage = { phase: "phase-02", turn: "run", kind: "network" };

  it("pauses resumable, exits 14 and names phax resume", async () => {
    const { harness, result } = await startRun(outage);
    const err = leftOf(result);

    // The error carries the failure and the paused phase; the CLI exits 14.
    expect(err).toBeInstanceOf(AgentSessionFailedError);
    expect((err as AgentSessionFailedError).failure.kind).toBe("network");
    expect((err as AgentSessionFailedError).phaseId).toBe("phase-02");
    expect(exitCodeForError(err)).toBe(14);
    expect(pausedNetworkFailure(err)).toBe(err);

    // phase-01 finished; the run and phase-02 wait as a limit leaves them.
    expect(phaseStatus(harness, "phase-01")["state"]).toBe("cleaned_up");
    const status = runStatus(harness);
    expect(status["state"]).toBe("rate_limited");
    expect(status["stoppedReason"]).toBe("network_failure");
    expect(status["lastError"]).toBe(`claude-code session failed (network): ${API_ERROR}`);
    expect(phaseStatus(harness, "phase-02")["state"]).toBe("rate_limited");
    expect(handledEvents(harness)).toContain("NetworkFailureDetected");
    expect(handledEvents(harness)).not.toContain("RunFailed");

    // The terminal lines: the failure, the pause, the one command to run.
    const lines = renderNetworkPause(
      err as AgentSessionFailedError,
      SHORT,
      join(harness.runPath, "resume-instructions.md"),
    );
    expect(lines[0]).toBe(`✗ claude-code session failed (network): ${API_ERROR}`);
    expect(lines).toContain(`  session: ${SESSION}`);
    const printed = lines.join("\n");
    expect(printed).toContain(`Run ${SHORT} is paused at phase-02.`);
    expect(printed).toContain(`Retry once the network is back: phax resume ${SHORT}`);
    expect(printed).toContain("resume-instructions.md");
  });

  it("writes resume instructions that name the session the failure reported", async () => {
    const { harness } = await startRun(outage);

    const instructions = readFileSync(join(harness.runPath, "resume-instructions.md"), "utf8");

    expect(instructions).toContain("Network failure");
    expect(instructions).toContain(`phax resume ${SHORT}`);
    expect(instructions).toContain("phase-02");
    expect(instructions).toContain(SESSION);
    expect(instructions).toContain(API_ERROR);
    expect(instructions).not.toContain("Reset time");
  });

  it("continues the phase to review on a later resume", async () => {
    const { harness } = await startRun(outage);

    const resumed = await resume(harness);

    expect(Either.isRight(resumed)).toBe(true);
    expect(runStatus(harness)["state"]).toBe("review_open");
    expect(phaseStatus(harness, "phase-02")["state"]).toBe("review_open");
    // phase-01 ran once; phase-02 ran its work turn again on the resume.
    expect(harness.turns.filter((t) => t.kind === "run" && t.phase === "phase-01")).toHaveLength(1);
    expect(harness.turns.filter((t) => t.kind === "run" && t.phase === "phase-02")).toHaveLength(2);
  });
});

// ── A handoff turn that fails ──────────────────────────────────────────────

describe("a phase whose handoff turn fails", { timeout: 60_000 }, () => {
  it("reports a network failure as itself and dispatches no HandoffMissing", async () => {
    const { harness, result } = await startRun({
      phase: "phase-01",
      turn: "resume",
      kind: "network",
    });
    const err = leftOf(result);

    expect(err).toBeInstanceOf(HandoffPausedError);
    const failure = pausedHandoffFailure(err);
    expect(failure?.failure).toMatchObject({ kind: "network", message: API_ERROR });
    expect(failure?.phaseId).toBe("phase-01");

    const events = handledEvents(harness);
    expect(events).toContain("HandoffTurnFailed");
    expect(events).not.toContain("HandoffMissing");
    expect(
      harness.telemetry.impl
        .events()
        .some((e) => e.type === "step.completed" && e.step === "dispatch.HandoffMissing"),
    ).toBe(false);

    const status = runStatus(harness);
    expect(status["state"]).toBe("interrupted");
    expect(status["stoppedReason"]).toBe("handoff_turn_failed");
    expect(status["lastError"]).toBe(`claude-code session failed (network): ${API_ERROR}`);
    expect(phaseStatus(harness, "phase-01")["state"]).toBe("handoff_failed");

    const lines = renderHandoffTurnPause(failure!, SHORT);
    expect(lines[0]).toBe(`✗ claude-code session failed (network): ${API_ERROR}`);
    expect(lines).toContain(`  Retry once the network is back: phax resume ${SHORT}`);
  });

  it("a resume re-runs only the handoff and continues to review", async () => {
    const { harness } = await startRun({ phase: "phase-01", turn: "resume", kind: "network" });

    const resumed = await resume(harness);

    expect(Either.isLeft(resumed) ? String(resumed.left) : null).toBeNull();
    expect(runStatus(harness)["state"]).toBe("review_open");
    // phase-01's work turn ran once, in the first process; its handoff ran twice.
    expect(harness.turns.filter((t) => t.kind === "run" && t.phase === "phase-01")).toHaveLength(1);
    expect(harness.turns.filter((t) => t.kind === "resume" && t.phase === "phase-01")).toHaveLength(
      2,
    );
  });

  it.each([
    ["network", 14],
    ["provider-error", 5],
    ["max-turns", 5],
    ["unknown", 5],
  ] satisfies ReadonlyArray<readonly [FailureKind, number]>)(
    "a %s failure exits %i",
    async (kind, code) => {
      const { harness, result } = await startRun({ phase: "phase-01", turn: "resume", kind });
      const err = leftOf(result);

      expect(err).toBeInstanceOf(HandoffPausedError);
      expect(exitCodeForError(err)).toBe(code);
      const lines = renderHandoffTurnPause(pausedHandoffFailure(err)!, SHORT);
      expect(lines[0]).toContain(`claude-code session failed (${kind})`);
      expect(lines.join("\n")).toContain(`phax resume ${SHORT}`);
      expect(handledEvents(harness)).not.toContain("HandoffMissing");
    },
  );
});

// ── A 429 printed by a tool is not a limit ─────────────────────────────────

describe("a phase session whose tool output printed HTTP 429", { timeout: 60_000 }, () => {
  let cli: FakeProviderCli;

  beforeEach(() => {
    cli = makeFakeProviderCli(world.root);
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
  });

  it("prints a provider-error failure, exits 5 and leaves the run not rate_limited", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: [
        { type: "system", subtype: "init", session_id: SESSION, tools: [] },
        {
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", content: "HTTP 429 Too Many Requests" }],
          },
        },
        { type: "result", is_error: true, subtype: "error_during_execution", session_id: SESSION },
      ],
      exitCode: 1,
    });

    const { harness, result } = await startRun(null, makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG));
    const err = leftOf(result);

    expect(err).toBeInstanceOf(AgentSessionFailedError);
    expect(exitCodeForError(err)).toBe(5);
    expect(pausedNetworkFailure(err)).toBeNull();
    const lines = renderSessionFailure(err as AgentSessionFailedError, null);
    expect(lines[0]).toBe("✗ claude-code session failed (provider-error): error_during_execution");
    expect(lines[0]).not.toContain("rate");

    const status = runStatus(harness);
    expect(status["state"]).not.toBe("rate_limited");
    expect(status["state"]).toBe("failed");
    expect(status["stoppedReason"]).not.toBe("network_failure");
    expect(existsSync(join(harness.runPath, "resume-instructions.md"))).toBe(false);
    expect(handledEvents(harness)).not.toContain("RateLimitDetected");
    expect(handledEvents(harness)).not.toContain("NetworkFailureDetected");
  });
});

// ── Claude Code's own API-error endings, through the real node backend ──────

// The synthetic API-error message and the error result Claude Code 2.1.312
// ends a session with when the API refused or never answered.
function claudeApiErrorStream(text: string, category: string, status: number | null) {
  return [
    { type: "system", subtype: "init", session_id: SESSION, tools: [] },
    {
      type: "assistant",
      message: {
        model: "<synthetic>",
        role: "assistant",
        type: "message",
        content: [{ type: "text", text }],
      },
      session_id: SESSION,
      error: category,
      is_api_error_message: true,
    },
    {
      type: "result",
      subtype: "success",
      is_error: true,
      num_turns: 1,
      terminal_reason: "api_error",
      api_error_status: status,
      result: text,
      session_id: SESSION,
    },
  ];
}

describe("a phase session Claude Code ends on an API error", { timeout: 60_000 }, () => {
  let cli: FakeProviderCli;

  beforeEach(() => {
    cli = makeFakeProviderCli(world.root);
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
  });

  it("pauses the run rate_limited and exits 8 on Claude Code's plan limit", async () => {
    const limit = "You've hit your session limit · resets 7:50pm (Europe/Paris)";
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: [
        {
          type: "rate_limit_event",
          rate_limit_info: { status: "rejected", resetsAt: 1793120400, rateLimitType: "five_hour" },
          session_id: SESSION,
        },
        ...claudeApiErrorStream(limit, "rate_limit", 429),
      ],
      exitCode: 1,
    });

    const { harness, result } = await startRun(null, makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG));
    const err = leftOf(result);

    expect(exitCodeForError(err)).toBe(8);
    expect(err).toMatchObject({
      _tag: "UsageLimitError",
      rawMessage: limit,
      resetAt: new Date(1793120400 * 1000).toISOString(),
    });
    expect(runStatus(harness)["state"]).toBe("rate_limited");
    expect(phaseStatus(harness, "phase-01")["state"]).toBe("rate_limited");
    expect(handledEvents(harness)).not.toContain("RunFailed");
  });

  it("pauses the run and exits 14 on a connection failure Claude Code words its own way", async () => {
    const apiError = "API Error: Unable to connect to API (FailedToOpenSocket)";
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: claudeApiErrorStream(apiError, "server_error", null),
      exitCode: 1,
    });

    const { harness, result } = await startRun(null, makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG));
    const err = leftOf(result);

    expect(err).toBeInstanceOf(AgentSessionFailedError);
    expect((err as AgentSessionFailedError).failure).toMatchObject({
      kind: "network",
      message: apiError,
    });
    expect(exitCodeForError(err)).toBe(14);
    expect(runStatus(harness)["state"]).toBe("rate_limited");
    expect(runStatus(harness)["stoppedReason"]).toBe("network_failure");
  });
});
