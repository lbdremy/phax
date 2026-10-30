import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan, type ClosedStop } from "../../src/app/executePlan.js";
import { withRunLock } from "../../src/app/lock.js";
import { resetPhase } from "../../src/app/resetPhase.js";
import { inspectResumeOnDisk } from "../helpers/inspectResume.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { renderStop, renderStopClosed } from "../../src/cli/commands/stopOutput.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import {
  decodeShortName,
  type ClaudeSessionId,
  type RunId,
  type ShortName,
} from "../../src/domain/branded.js";
import {
  AgentInvocationError,
  AssignmentPreflightError,
  AwaitingReviewStopError,
  CleanupPausedError,
  WorktreeCreationError,
} from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeNodeBackendLayer } from "../../src/infra/claudeCli.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend, type AgentRunOptions, type BackendOps } from "../../src/ports/backend.js";
import { Shell } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { Assignments } from "../../src/schemas/assignments.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The made-up invoice-export plan of six phases, phase-03 declared
// interactive, run end to end through executePlan: real git on a temporary
// repository, the real file system, a backend playing every provider turn and
// a shell whose `pnpm` steps are scripted while every other command runs.

const NAMESPACE = "example";
const SHORT = "invoice-export";
const SESSION_FIRST_TURN = "019a2f6e-0000-4000-8000-000000000001";

const FIRST_READING = JSON.stringify({
  $schema: currentSchemaUrl("first-reading"),
  pattern: ["The InvoiceRow column order"],
  copiedBy: [{ phase: "phase-04", what: "the column order" }],
  toCheck: ["Whether `invoice_no` should read `Invoice number`"],
});

const CLOSING_ANSWER = JSON.stringify({
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

const CORRECTED_HEADER = "export const header = 'Invoice number';\n";

const handoffOf = (phaseId: string, tail = "Ready to proceed."): string =>
  [
    "## What was delivered",
    `- ${phaseId} delivered its file.`,
    "## Key decisions and why",
    "- None.",
    "## Exact locations (file paths and exported names)",
    `- src/${phaseId}.ts`,
    "## What the next phase needs to know",
    `- ${tail}`,
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-declared-stop-run-test-")));
  const repoRoot = join(root, "repo");
  const stateRoot = join(root, "state");
  mkdirSync(join(repoRoot, "src", "export"), { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  vi.stubEnv("HOME", join(root, "home"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(repoRoot);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  writeFileSync(join(repoRoot, ".gitignore"), ".phax-context/\n.setup-marker\n");
  writeFileSync(
    join(repoRoot, "src", "export", "invoiceRow.ts"),
    "export const header = 'invoice_no';\n",
  );
  git("add", "-A");
  git("commit", "-m", "chore: start");
  world = { root, repoRoot, stateRoot };
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(world.root);
});

// ── The plan ───────────────────────────────────────────────────────────────

interface PhaseSpec {
  readonly title: string;
  readonly interactive?: boolean;
  readonly model?: string;
  readonly effort?: "low" | "medium" | "high";
}

const INVOICE_EXPORT: readonly PhaseSpec[] = [
  { title: "Export port" },
  { title: "Invoice CSV record" },
  { title: "Review the export record", interactive: true },
  { title: "Credit-note CSV record" },
  { title: "Refund CSV record" },
  { title: "Export command" },
];

const idOf = (index: number): string => `phase-${String(index + 1).padStart(2, "0")}`;

function planOf(specs: readonly PhaseSpec[]): { plan: PhaxPlan; planMd: string } {
  const plan = {
    run: {
      shortName: SHORT,
      title: "Invoice export",
      branch: `phax/${SHORT}`,
      requiredCommands: [],
    },
    phases: specs.map(
      (spec, i): PhaxPlanPhase => ({
        id: idOf(i),
        title: spec.title,
        model: spec.model ?? "claude-sonnet-5-5",
        effort: spec.effort ?? "medium",
        planMarkdownAnchor: `#${idOf(i)}`,
        plannedFilesToCreate: spec.interactive === true ? [] : [`src/${idOf(i)}.ts`],
        plannedFilesToEdit: [],
        optionalFilesToEdit: spec.interactive === true ? ["src/export/invoiceRow.ts"] : [],
        mode: spec.interactive === true ? "interactive" : "headless",
        oracle: null,
        testLines: [],
        commit: { subject: `feat(export): ${spec.title.toLowerCase()}`, body: "Made-up body." },
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
      ...(phase.mode === "interactive" ? ["**Mode:** interactive"] : []),
      "",
      "### Detailed instructions",
      "",
      phase.mode === "interactive"
        ? "Review the InvoiceRow column order and the header wording phase-02 set."
        : `Write src/${phase.id}.ts.`,
      "",
    ]),
  ].join("\n");
  return { plan, planMd };
}

function configOf(
  opts: { cleanupExitCode?: () => number; assignments?: Assignments } = {},
): ResolvedConfig {
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
    ...(opts.assignments !== undefined ? { assignments: opts.assignments } : {}),
  } as ResolvedConfig;
}

// ── The provider and the shell ─────────────────────────────────────────────

interface Turn {
  readonly kind: "run" | "resume";
  readonly prompt: string;
  readonly options: AgentRunOptions;
}

const phaseOf = (options: AgentRunOptions): string =>
  basename(options.phaseFolderPath ?? options.cwd);

const unused = () => Effect.fail(new AgentInvocationError({ message: "not played by this test" }));

// A provider always writes the turn's stream.
const stream = (options: AgentRunOptions): void => {
  if (options.outputJsonlPath !== undefined) writeFileSync(options.outputJsonlPath, "");
};

// A headless phase writes its planned file, and its handoff when phax resumes
// it for one. A read-only turn answers a first reading on a run and a closing
// handoff on a resume. `readOnly` turns go to `readOnlyBackend` when given.
function playingBackend(opts: {
  readonly turns: Turn[];
  readonly handoffTail?: Readonly<Record<string, string>>;
  readonly readOnlyBackend?: BackendOps;
}): BackendOps {
  return {
    runAgent: (prompt, options) => {
      opts.turns.push({ kind: "run", prompt, options });
      if (options.readOnly === true) {
        if (opts.readOnlyBackend !== undefined) {
          return opts.readOnlyBackend.runAgent(prompt, options);
        }
        stream(options);
        return Effect.succeed({
          sessionId: SESSION_FIRST_TURN as ClaudeSessionId,
          outputPath: "",
          finalText: FIRST_READING,
          structured: null,
        });
      }
      const phase = phaseOf(options);
      return Effect.sync(() => {
        writeFileSync(
          join(options.cwd, "src", `${phase}.ts`),
          `export const ${phase.replace("-", "")} = 1;\n`,
        );
        return {
          sessionId: `sess-${phase}` as ClaudeSessionId,
          outputPath: "",
          finalText: "",
          structured: null,
        };
      });
    },
    resumeAgentSession: (sessionId, prompt, options) => {
      opts.turns.push({ kind: "resume", prompt, options });
      if (options.readOnly === true) {
        if (opts.readOnlyBackend !== undefined) {
          return opts.readOnlyBackend.resumeAgentSession(sessionId, prompt, options);
        }
        stream(options);
        return Effect.succeed({
          sessionId,
          outputPath: "",
          finalText: CLOSING_ANSWER,
          structured: null,
        });
      }
      const phase = phaseOf(options);
      return Effect.sync(() => {
        writeFileSync(
          join(options.cwd, ".phax-context", "phase-handoff.md"),
          handoffOf(phase, opts.handoffTail?.[phase]),
        );
        return { sessionId, outputPath: "", finalText: "", structured: null };
      });
    },
    complete: unused,
    probe: unused,
    captureTranscript: () =>
      Effect.succeed({ status: "missing", reason: "not-found", detail: "not played by this test" }),
  };
}

interface ShellCall {
  readonly line: string;
  readonly cwd: string | undefined;
}

const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));

// `pnpm …` steps are scripted and recorded; every other command runs for real.
function scriptedShell(calls: ShellCall[], exitCodeOf: (call: ShellCall) => number = () => 0) {
  return Layer.succeed(Shell, {
    run: (options) => {
      const line = options.command.join(" ");
      if (options.command[0] !== "pnpm") return realShell.run(options);
      const call = { line, cwd: options.cwd };
      calls.push(call);
      const exitCode = exitCodeOf(call);
      return Effect.succeed({
        exitCode,
        stdout: "",
        stderr: exitCode === 0 ? "" : `${line} failed`,
        stdoutEncoding: "utf8" as const,
      });
    },
  });
}

// ── Running ────────────────────────────────────────────────────────────────

interface Harness {
  readonly shortName: ShortName;
  readonly plan: PhaxPlan;
  readonly planMd: string;
  readonly runPath: string;
  readonly runId: RunId;
  readonly turns: Turn[];
  readonly shellCalls: ShellCall[];
  readonly lock: ReturnType<typeof makeFakeLock>;
  readonly closed: ClosedStop[];
  config: ResolvedConfig;
  backend: BackendOps;
  shellExitCode: (call: ShellCall) => number;
}

async function startRun(
  specs: readonly PhaseSpec[] = INVOICE_EXPORT,
  opts: {
    handoffTail?: Readonly<Record<string, string>>;
    assignments?: Assignments;
    readOnlyBackend?: BackendOps;
  } = {},
): Promise<{ harness: Harness; result: Either.Either<unknown, unknown> }> {
  const shortName = Either.getOrThrow(decodeShortName(SHORT));
  const { plan, planMd } = planOf(specs);
  const config = configOf(opts.assignments !== undefined ? { assignments: opts.assignments } : {});
  const turns: Turn[] = [];
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
    shellCalls: [],
    lock: makeFakeLock(),
    closed: [],
    config,
    backend: playingBackend({
      turns,
      ...(opts.handoffTail !== undefined ? { handoffTail: opts.handoffTail } : {}),
      ...(opts.readOnlyBackend !== undefined ? { readOnlyBackend: opts.readOnlyBackend } : {}),
    }),
    shellExitCode: () => 0,
  };
  const result = await execute(harness, 0);
  return { harness, result };
}

async function execute(harness: Harness, startIndex: number) {
  const program = withRunLock(
    `${NAMESPACE}.${SHORT}`,
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
      onStopClosed: (closed) => harness.closed.push(closed),
    }),
  );
  return Effect.runPromise(
    Effect.either(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Backend, harness.backend),
            NodeFileSystemLayer,
            NodeGitLayer,
            scriptedShell(harness.shellCalls, (call) => harness.shellExitCode(call)),
            NoopSystemTelemetryLayer,
            makeFakeGitHub().layer,
            harness.lock.layer,
          ),
        ),
      ),
    ),
  );
}

/** `phax resume --yes`: the start phase as the resume command decides it. */
async function resume(harness: Harness) {
  const decision = await inspectResumeOnDisk(NAMESPACE, harness.shortName, world.stateRoot);
  if (Either.isLeft(decision)) throw new Error(decision.left.message);
  return execute(harness, decision.right.nextPhaseIndex);
}

const worktreeOf = (phaseId: string): string =>
  join(world.stateRoot, "worktrees", `${NAMESPACE}.${SHORT}`, phaseId);

const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const runState = (h: Harness) => readJson(join(h.runPath, "run-status.json"))["state"];
const phaseStatus = (h: Harness, phaseId: string) =>
  readJson(join(h.runPath, phaseId, "status.json"));

function stopError(result: Either.Either<unknown, unknown>): AwaitingReviewStopError {
  if (Either.isRight(result)) throw new Error("the run did not stop");
  expect(result.left).toBeInstanceOf(AwaitingReviewStopError);
  return result.left as AwaitingReviewStopError;
}

function expectSucceeded(result: Either.Either<unknown, unknown>): void {
  if (Either.isLeft(result)) throw new Error(`the run failed: ${String(result.left)}`);
}

const correct = (): void =>
  writeFileSync(join(worktreeOf("phase-03"), "src", "export", "invoiceRow.ts"), CORRECTED_HEADER);

const turnsAt = (h: Harness, phaseId: string): Turn[] =>
  h.turns.filter((t) => t.options.cwd === worktreeOf(phaseId));

// ── Reaching the stop ──────────────────────────────────────────────────────

describe("phax run on a plan with a declared interactive phase", { timeout: 30_000 }, () => {
  it("commits phase-01 and phase-02, then stops at phase-03 after one read-only turn", async () => {
    const { harness, result } = await startRun();
    const error = stopError(result);

    expect(phaseStatus(harness, "phase-01")["state"]).toBe("cleaned_up");
    expect(phaseStatus(harness, "phase-02")["state"]).toBe("cleaned_up");
    const phase02Commit = phaseStatus(harness, "phase-02")["commitHash"];

    // phase-03's worktree sits on phase-02's commit, with the setup marker.
    const stopTree = worktreeOf("phase-03");
    expect(gitIn(stopTree, "rev-parse", "HEAD")).toBe(phase02Commit);
    expect(existsSync(join(stopTree, ".setup-marker"))).toBe(true);
    expect(existsSync(join(stopTree, ".phax-context", "plan.md"))).toBe(true);

    // Exactly one turn for phase-03: a read-only run; no work session, no gate.
    const stopTurns = turnsAt(harness, "phase-03");
    expect(stopTurns).toHaveLength(1);
    expect(stopTurns[0]).toMatchObject({ kind: "run", options: { readOnly: true } });
    expect(harness.shellCalls.filter((c) => c.cwd === stopTree)).toEqual([]);

    const status = phaseStatus(harness, "phase-03");
    expect(status).toMatchObject({
      state: "awaiting_review",
      mode: "interactive",
      stop: { cause: "declared", status: "waiting" },
    });
    expect(status["claudeSessionId"]).toBeUndefined();
    expect(existsSync(join(harness.runPath, "phase-03", "agent-binding.json"))).toBe(false);
    expect(existsSync(join(harness.runPath, "phase-03", "model-resolution.json"))).toBe(true);
    expect(existsSync(join(harness.runPath, "phase-03", "security.json"))).toBe(true);
    expect(runState(harness)).toBe("awaiting_review");
    expect(existsSync(join(harness.runPath, "review-stop.json"))).toBe(true);

    // phax run: exit 13, the stop printed, the lock released.
    expect(exitCodeForError(error)).toBe(13);
    const lines = renderStop(error.report);
    expect(lines[0]).toBe(
      "◐ phase-03  Review the export record — awaiting review (declared: interactive phase)",
    );
    expect(lines).toContain(`  Worktree:  ${stopTree}`);
    expect(lines).toContain("  Continue the session phax started:");
    expect(lines.some((l) => l.includes("'claude' '--resume'"))).toBe(true);
    expect(lines).toContain(`    or: phax enter-phase ${SHORT} phase-03`);
    expect(lines).toContain(`    phax resume ${SHORT}`);
    expect(lines).toContain(`  Stop: ${join(harness.runPath, "review-stop.json")}`);
    expect(lines.some((l) => l.includes("The InvoiceRow column order"))).toBe(true);
    expect(harness.lock.impl.statuses.get(`${NAMESPACE}.${SHORT}`)).toEqual({ kind: "none" });
  });

  it("never reads stdin, with no terminal and an idle stdin pipe", async () => {
    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const read = vi.spyOn(process.stdin, "read");
    const on = vi.spyOn(process.stdin, "on");
    const resumed = vi.spyOn(process.stdin, "resume");
    try {
      const { result } = await startRun();
      stopError(result);
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

// ── Closing the stop ───────────────────────────────────────────────────────

describe("phax resume at a declared stop", { timeout: 30_000 }, () => {
  it("closes phase-03 and runs phase-04 to the end in the same invocation", async () => {
    const { harness, result } = await startRun();
    stopError(result);
    const planJson = readFileSync(join(harness.runPath, "phax-plan.json"), "utf8");
    const planMd = readFileSync(join(harness.runPath, "plan.md"), "utf8");
    correct();

    expectSucceeded(await resume(harness));

    // The close: gated, handed off by a read-only closing turn, committed.
    expect(harness.closed).toHaveLength(1);
    const closed = harness.closed[0]!;
    expect(closed.report).toMatchObject({
      cause: "declared",
      outcome: "corrected",
      handoffSource: "closing-turn-resumed",
      changedPaths: ["src/export/invoiceRow.ts"],
    });
    if (closed.report.cause !== "declared") throw new Error("not a declared close");
    const { commit } = closed.report;
    const closeLines = renderStopClosed(closed);
    expect(closeLines[0]).toBe("phase-03 (declared): 1 file(s) changed by review");
    expect(closeLines).toContain("  gate  pnpm typecheck   pass");
    expect(closeLines.at(-1)).toBe(
      `✓ phase-03  Review the export record   committed  ${commit.slice(0, 7)}  (corrected)`,
    );
    const stopTree = worktreeOf("phase-03");
    const message = gitIn(stopTree, "log", "-1", "--format=%B", commit);
    expect(message).toContain("Interactive-Phase: phase-03");
    expect(phaseStatus(harness, "phase-03")).toMatchObject({
      state: "cleaned_up",
      stop: { cause: "declared", status: "closed", outcome: "corrected", oracleStep: "none" },
    });
    expect(harness.shellCalls).toContainEqual({ line: "pnpm cleanup", cwd: stopTree });

    // phase-04 branched from phase-03's commit and read the correction.
    expect(gitIn(worktreeOf("phase-04"), "rev-parse", "HEAD~1")).toBe(commit);
    const prompt = readFileSync(join(harness.runPath, "phase-04", "prompt.md"), "utf8");
    const previous = prompt.slice(prompt.indexOf("## Previous phase handoff"));
    expect(previous).toContain("- phase-02 delivered its file.");
    expect(previous.indexOf("## Review corrections")).toBeGreaterThan(0);
    expect(prompt).toContain("### phase-03 (interactive)");
    expect(prompt).toContain("The invoice header reads `Invoice number`");
    expect(prompt).toContain("- src/export/invoiceRow.ts");
    expect(prompt).toContain(
      "Where this section disagrees with an earlier phase's handoff, this section wins.",
    );

    // The plan stays as approved, and the run reaches review.
    expect(readFileSync(join(harness.runPath, "phax-plan.json"), "utf8")).toBe(planJson);
    expect(readFileSync(join(harness.runPath, "plan.md"), "utf8")).toBe(planMd);
    expect(runState(harness)).toBe("review_open");
    expect(existsSync(join(harness.runPath, "review-stop.json"))).toBe(false);

    // final-report.md labels phase-03 interactive with no session.
    const report = readFileSync(join(harness.runPath, "final-report.md"), "utf8");
    const row = report.split("\n").find((l) => l.startsWith("| phase-03 |"))!;
    expect(row).toContain("| Review the export record (interactive) |");
    expect(row.split("|").map((c) => c.trim())[7]).toBe("-");
    const perPhase = report.slice(report.indexOf("## Per-Phase Artifacts"));
    const artifacts = perPhase.slice(
      perPhase.indexOf("### phase-03"),
      perPhase.indexOf("### phase-04"),
    );
    expect(artifacts).toContain("phase-03/first-turn-01.jsonl");
    expect(artifacts).toContain("phase-03/closing-turn-01.jsonl");
    expect(artifacts).not.toContain("output.jsonl");
  });

  it("refuses a stop whose worktree is gone before anything changes, still awaiting review", async () => {
    const { harness, result } = await startRun();
    stopError(result);
    const stopTree = worktreeOf("phase-03");
    const reviewStop = readFileSync(join(harness.runPath, "review-stop.json"), "utf8");
    // The worktree goes after the resume command's own check passed.
    const decision = await inspectResumeOnDisk(NAMESPACE, harness.shortName, world.stateRoot);
    if (Either.isLeft(decision)) throw new Error(decision.left.message);
    renameSync(stopTree, `${stopTree}.moved`);

    const refused = await execute(harness, decision.right.nextPhaseIndex);

    expect(Either.isLeft(refused) && refused.left).toBeInstanceOf(WorktreeCreationError);
    expect(runState(harness)).toBe("awaiting_review");
    expect(phaseStatus(harness, "phase-03")["state"]).toBe("awaiting_review");
    expect(readFileSync(join(harness.runPath, "review-stop.json"), "utf8")).toBe(reviewStop);
    expect(existsSync(join(harness.runPath, "phase-03", "review-stop.closing.json"))).toBe(false);
    expect(harness.closed).toEqual([]);

    // Put back, the worktree closes as usual.
    renameSync(`${stopTree}.moved`, stopTree);
    correct();
    expectSucceeded(await resume(harness));
    expect(harness.closed).toHaveLength(1);
  });

  it("a reset at the stop sets phase-03 up again and stops after a new first turn", async () => {
    const { harness, result } = await startRun();
    stopError(result);
    const phase02Commit = phaseStatus(harness, "phase-02")["commitHash"];
    correct();

    const reset = await Effect.runPromise(
      Effect.either(
        resetPhase({
          namespace: NAMESPACE,
          shortName: harness.shortName,
          phaseId: "phase-03",
          stateRoot: world.stateRoot,
          repoRoot: world.repoRoot,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeFileSystemLayer,
              NodeGitLayer,
              scriptedShell([]),
              NoopSystemTelemetryLayer,
              harness.lock.layer,
            ),
          ),
        ),
      ),
    );
    expect(Either.isRight(reset)).toBe(true);
    const turnsBefore = turnsAt(harness, "phase-03").length;

    const again = stopError(await resume(harness));

    expect(exitCodeForError(again)).toBe(13);
    const stopTree = worktreeOf("phase-03");
    expect(gitIn(stopTree, "rev-parse", "HEAD")).toBe(phase02Commit);
    expect(readFileSync(join(stopTree, "src", "export", "invoiceRow.ts"), "utf8")).toBe(
      "export const header = 'invoice_no';\n",
    );
    expect(existsSync(join(stopTree, ".phax-context", "interactive-review.md"))).toBe(true);
    const newTurns = turnsAt(harness, "phase-03").slice(turnsBefore);
    expect(newTurns).toHaveLength(1);
    expect(newTurns[0]).toMatchObject({ kind: "run", options: { readOnly: true } });
    expect(runState(harness)).toBe("awaiting_review");
    expect(harness.closed).toEqual([]);
  });

  it("a cleanup that fails after the close pauses at cleaning_up; the next resume runs only it", async () => {
    const { harness, result } = await startRun();
    stopError(result);
    correct();
    const stopTree = worktreeOf("phase-03");
    harness.shellExitCode = (call) =>
      call.line === "pnpm cleanup" && call.cwd === stopTree ? 1 : 0;

    const paused = await resume(harness);

    expect(Either.isLeft(paused) && paused.left).toBeInstanceOf(CleanupPausedError);
    expect(phaseStatus(harness, "phase-03")["state"]).toBe("cleaning_up");
    expect(phaseStatus(harness, "phase-03")["claudeSessionId"]).toBeUndefined();
    expect(runState(harness)).toBe("interrupted");
    expect(existsSync(join(harness.runPath, "phase-04"))).toBe(false);

    harness.shellExitCode = () => 0;
    const turnsBefore = turnsAt(harness, "phase-03").length;
    const gateCallsBefore = harness.shellCalls.filter(
      (c) => c.cwd === stopTree && c.line === "pnpm typecheck",
    ).length;
    expectSucceeded(await resume(harness));

    expect(turnsAt(harness, "phase-03").length).toBe(turnsBefore);
    expect(
      harness.shellCalls.filter((c) => c.cwd === stopTree && c.line === "pnpm typecheck"),
    ).toHaveLength(gateCallsBefore);
    expect(harness.closed).toHaveLength(1);
    expect(phaseStatus(harness, "phase-03")["state"]).toBe("cleaned_up");
    expect(existsSync(join(harness.runPath, "phase-04", "prompt.md"))).toBe(true);
    expect(runState(harness)).toBe("review_open");
  });
});

// ── Runs without a stop ────────────────────────────────────────────────────

describe("a plan with no interactive phase", { timeout: 30_000 }, () => {
  const HEADLESS: readonly PhaseSpec[] = [
    { title: "Export port" },
    { title: "Invoice CSV record" },
    { title: "Export command" },
  ];

  it("never stops, carries no Review corrections and writes headless phase statuses", async () => {
    const { harness, result } = await startRun(HEADLESS);
    expectSucceeded(result);

    expect(runState(harness)).toBe("review_open");
    expect(harness.turns.some((t) => t.options.readOnly === true)).toBe(false);
    for (const phaseId of ["phase-01", "phase-02", "phase-03"]) {
      expect(phaseStatus(harness, phaseId)).toMatchObject({ mode: "headless", stop: null });
      const prompt = readFileSync(join(harness.runPath, phaseId, "prompt.md"), "utf8");
      expect(prompt).not.toContain("## Review corrections");
    }
    expect(existsSync(join(harness.runPath, "review-stop.json"))).toBe(false);
  });

  it("never stops when a phase's handoff ends with a question to a person", async () => {
    const { harness, result } = await startRun(HEADLESS, {
      handoffTail: { "phase-02": "Should a person confirm the `invoice_no` header wording?" },
    });
    expectSucceeded(result);
    expect(runState(harness)).toBe("review_open");
    expect(harness.closed).toEqual([]);
  });
});

// ── Assignment bounds and the turns' cost ──────────────────────────────────

describe("an interactive phase under the assignment bounds", { timeout: 30_000 }, () => {
  const EXPORT_BOUND: Assignments = [
    {
      kind: "globs",
      globs: ["src/export/**"],
      model: "claude-opus-5-5",
      effort: { min: "medium", max: "high" },
    },
  ] as unknown as Assignments;

  it("refuses an interactive phase that departs from its governing bound", async () => {
    const specs = INVOICE_EXPORT.map((s, i) =>
      i === 2 ? { ...s, model: "gpt-6-luna", effort: "medium" as const } : s,
    );
    const { harness, result } = await startRun(specs, { assignments: EXPORT_BOUND });

    expect(Either.isLeft(result) && result.left).toBeInstanceOf(AssignmentPreflightError);
    const message = (result as Either.Left<AssignmentPreflightError, unknown>).left.message;
    expect(message).toContain("phase-03 (gpt-6-luna/medium)");
    expect(message).toContain("assignments[0]");
    expect(harness.turns).toEqual([]);
  });

  describe("through the fake claude CLI", () => {
    let cli: FakeProviderCli;

    beforeEach(() => {
      cli = makeFakeProviderCli(join(world.root, "cli"));
      for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
    });

    it("runs the first and closing turns at the bound's model and effort, each costed once", async () => {
      const specs = INVOICE_EXPORT.map((s, i) =>
        i === 2 ? { ...s, model: "claude-opus-5-5", effort: "high" as const } : s,
      );
      const realBackend = Effect.runSync(
        Effect.provide(Backend, makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG)),
      );
      cli.setScript({ sessionId: SESSION_FIRST_TURN, finalText: FIRST_READING });
      const { harness, result } = await startRun(specs, {
        assignments: EXPORT_BOUND,
        readOnlyBackend: realBackend,
      });
      stopError(result);
      correct();
      cli.setScript({ sessionId: SESSION_FIRST_TURN, finalText: CLOSING_ANSWER });

      expectSucceeded(await resume(harness));

      const spawned = cli.invocations().filter((i) => i.cwd === worktreeOf("phase-03"));
      expect(spawned).toHaveLength(2);
      for (const invocation of spawned) {
        const argv = invocation.argv.join(" ");
        expect(argv).toContain("--model claude-opus-5-5");
        expect(argv).toContain("--effort high");
      }
      expect(spawned[1]!.argv).toContain("--resume");

      const ledger = readJson(join(harness.runPath, "cost-ledger.json"));
      const entries = (ledger["entries"] as { role: string; phase: string }[]).filter(
        (e) => e.phase === "phase-03",
      );
      expect(entries.map((e) => e.role).toSorted()).toEqual(["closing-turn", "first-turn"]);
      expect(harness.closed[0]?.report.handoffSource).toBe("closing-turn-resumed");
    });
  });
});
