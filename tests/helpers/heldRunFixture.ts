import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { executePlan, type ClosedStop } from "../../src/app/executePlan.js";
import { withRunLock } from "../../src/app/lock.js";
import { inspectResumeOnDisk } from "./inspectResume.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type ClaudeSessionId, type RunId } from "../../src/domain/branded.js";
import { AgentInvocationError, RateLimitError } from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { persistSessionId } from "../../src/infra/providers/sessionWriter.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Backend, type AgentRunOptions, type BackendOps } from "../../src/ports/backend.js";
import { FileSystem, FsError } from "../../src/ports/fs.js";
import { Shell } from "../../src/ports/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import type { RunHold } from "../../src/schemas/status.js";
import { isolateGit } from "./isolateGit.js";
import { providerStoreRootsUnder } from "./providerStoreRoots.js";
import { disableGitAutoMaintenance, removeTempDir } from "./tempGit.js";

// A made-up world for a run that holds phases: the six-phase invoice-export
// plan (phase-03 declared interactive, phase-02 built on codex), run through
// the real `createRunFolder` with a recorded hold and the real `executePlan`
// on a temporary repository. Real git, the real file system, a fake backend
// that plays every provider turn and logs it, and a shell whose `pnpm` steps
// are scripted while every other command runs. Each world stubs HOME; the
// suites using it also mock `loadRouting`, so nothing reads `~/.phax`.

export const NAMESPACE = "example";
export const SHORT = "invoice-export";
export const RUN_KEY = `${NAMESPACE}.${SHORT}`;

/** The session each phase's headless run reports: phase-02 is built in X0. */
const BUILDER_SESSIONS: Readonly<Record<string, string>> = {
  "phase-01": "X1",
  "phase-02": "X0",
  "phase-04": "X2",
  "phase-05": "X3",
  "phase-06": "X4",
};

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

export const handoffOf = (phaseId: string): string =>
  [
    "## What was delivered",
    `- ${phaseId} delivered src/${phaseId}.ts.`,
    "## Key decisions and why",
    "- None.",
    "## Exact locations (file paths and exported names)",
    `- src/${phaseId}.ts`,
    "## What the next phase needs to know",
    `- ${phaseId} is ready.`,
    "",
  ].join("\n");

// ── The world ──────────────────────────────────────────────────────────────

export interface HeldWorld {
  readonly root: string;
  readonly repoRoot: string;
  readonly stateRoot: string;
  readonly home: string;
  cleanup(): void;
}

/**
 * A temporary repository with one commit and an empty state root, git
 * isolated from the person's configuration until `cleanup` (isolateGit). The
 * caller stubs HOME to `home` (vi.stubEnv) and calls `cleanup` after the test.
 */
export function createHeldWorld(): HeldWorld {
  const restoreGit = isolateGit();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-held-run-test-")));
  const repoRoot = join(root, "repo");
  const stateRoot = join(root, "state");
  const home = join(root, "home");
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(repoRoot);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  writeFileSync(join(repoRoot, ".gitignore"), ".phax-context/\n.setup-marker\n.cleanup-marker\n");
  writeFileSync(join(repoRoot, "src", "invoiceRow.ts"), "export const header = 'invoice_no';\n");
  git("add", "-A");
  git("commit", "-m", "chore: start");
  const cleanup = (): void => {
    removeTempDir(root);
    restoreGit();
  };
  return { root, repoRoot, stateRoot, home, cleanup };
}

// ── The plan ───────────────────────────────────────────────────────────────

const PHASES: readonly { title: string; interactive?: boolean; model?: string }[] = [
  { title: "Export port" },
  { title: "Invoice CSV record", model: "gpt-6-luna" },
  { title: "Review the export record", interactive: true },
  { title: "Credit-note CSV record" },
  { title: "Refund CSV record" },
  { title: "Export command" },
];

const idOf = (index: number): string => `phase-${String(index + 1).padStart(2, "0")}`;

/** The made-up invoice-export plan and its plan.md; `models` overrides a phase's model by id. */
export function invoiceExportPlan(models: Readonly<Record<string, string>> = {}): {
  plan: PhaxPlan;
  planMd: string;
} {
  const plan = {
    run: {
      shortName: SHORT,
      title: "Invoice export",
      branch: `phax/${SHORT}`,
      requiredCommands: [],
    },
    phases: PHASES.map(
      (spec, i): PhaxPlanPhase => ({
        id: idOf(i),
        title: spec.title,
        model: models[idOf(i)] ?? spec.model ?? "claude-sonnet-5-5",
        effort: "medium",
        planMarkdownAnchor: `#${idOf(i)}`,
        plannedFilesToCreate: spec.interactive === true ? [] : [`src/${idOf(i)}.ts`],
        plannedFilesToEdit: [],
        optionalFilesToEdit: spec.interactive === true ? ["src/invoiceRow.ts"] : [],
        mode: spec.interactive === true ? "interactive" : "headless",
        oracle: null,
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
  world: HeldWorld,
  records: boolean,
  oracles: { readonly command: string } | undefined,
): ResolvedConfig {
  return {
    ...(oracles === undefined ? {} : { oracles }),
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: world.stateRoot },
      gateProfiles: {
        standard: [
          { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
        ],
      },
      commands: { setup: ["touch .setup-marker"], cleanup: ["touch .cleanup-marker"] },
    },
    stateRoot: world.stateRoot,
    namespace: NAMESPACE,
    repoRoot: world.repoRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    records: {
      enabled: records,
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

/**
 * The default provider config with codex enabled: under the default priority
 * every headless phase routes to codex, phase-02's gpt-6-luna natively.
 */
const HELD_PROVIDER_CONFIG: ProviderConfig = {
  ...DEFAULT_PROVIDER_CONFIG,
  providers: {
    ...DEFAULT_PROVIDER_CONFIG.providers,
    "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!, enabled: true },
  },
};

// ── The fake backend and the shell ─────────────────────────────────────────

export interface BackendCall {
  readonly kind: "run" | "resume";
  /** The phase the call ran for: its run folder's or its worktree's name. */
  readonly phase: string;
  readonly prompt: string;
  readonly options: AgentRunOptions;
}

interface HeldBackend extends BackendOps {
  readonly calls: BackendCall[];
  /** Phases whose next handoff turn writes a handoff missing its sections. */
  readonly brokenHandoffs: Set<string>;
  /** Phases whose next headless run hits the provider's rate limit before any work. */
  readonly rateLimited: Set<string>;
  /** Called after a phase's handoff turn wrote the handoff: its phase and folder. */
  onHandoff: ((phase: string, phaseFolderPath: string | undefined) => void) | undefined;
  /** Called when a headless run builds a phase, after it wrote the phase's file: its phase and worktree. */
  onBuild: ((phase: string, worktree: string) => void) | undefined;
  /** Called before a read-only turn (a first or closing turn) answers: its phase. */
  onReadOnly: ((phase: string) => void) | undefined;
  /** The session a first turn reports; F1 by default. */
  firstTurnSession: string;
  /** Whether the next first turns fail as the provider erroring; false by default. */
  firstTurnFails: boolean;
  /** The builder session a phase's headless run reports, over the default one. */
  readonly builderSessions: Map<string, string>;
  /** The provider stores: each session's transcript text; any other is not found. */
  readonly transcripts: Map<string, string>;
}

const phaseOf = (options: AgentRunOptions): string =>
  basename(options.phaseFolderPath ?? options.cwd);

const unused = () => Effect.fail(new AgentInvocationError({ message: "not played by this test" }));

const stream = (options: AgentRunOptions): void => {
  if (options.outputJsonlPath !== undefined) writeFileSync(options.outputJsonlPath, "");
};

/**
 * A headless run writes the phase's planned file and reports its builder
 * session, which it persists as a real provider does; a headless resume writes
 * the phase's handoff. A read-only run answers a first reading, a read-only
 * resume a closing handoff. Every call is logged.
 */
function makeHeldBackend(): HeldBackend {
  const calls: BackendCall[] = [];
  const brokenHandoffs = new Set<string>();
  const rateLimited = new Set<string>();
  const backend: HeldBackend = {
    calls,
    brokenHandoffs,
    rateLimited,
    onHandoff: undefined,
    onBuild: undefined,
    onReadOnly: undefined,
    firstTurnSession: "F1",
    firstTurnFails: false,
    builderSessions: new Map(),
    transcripts: new Map(),
    runAgent: (prompt, options) => {
      const phase = phaseOf(options);
      calls.push({ kind: "run", phase, prompt, options });
      stream(options);
      if (options.readOnly === true) {
        backend.onReadOnly?.(phase);
        if (backend.firstTurnFails) {
          return Effect.fail(new AgentInvocationError({ message: "the provider failed" }));
        }
        return Effect.succeed({
          sessionId: backend.firstTurnSession as ClaudeSessionId,
          outputPath: "",
          finalText: FIRST_READING,
        });
      }
      if (rateLimited.delete(phase)) {
        return Effect.fail(
          new RateLimitError({
            message: "Rate limit reached",
            rawMessage: "429: rate limit reached, try again at 18:00",
            resetAt: "2026-10-23T18:00:00Z",
            phaseId: phase,
          }),
        );
      }
      const sessionId = (backend.builderSessions.get(phase) ??
        BUILDER_SESSIONS[phase] ??
        `X-${phase}`) as ClaudeSessionId;
      return Effect.promise(async () => {
        writeFileSync(
          join(options.cwd, "src", `${phase}.ts`),
          `export const ${phase.replace("-", "")} = 1;\n`,
        );
        backend.onBuild?.(phase, options.cwd);
        if (options.phaseFolderPath !== undefined) {
          await persistSessionId(sessionId, options.phaseFolderPath);
        }
        return { sessionId, outputPath: "", finalText: "" };
      });
    },
    resumeAgentSession: (sessionId, prompt, options) => {
      const phase = phaseOf(options);
      calls.push({ kind: "resume", phase, prompt, options });
      stream(options);
      if (options.readOnly === true) {
        backend.onReadOnly?.(phase);
        return Effect.succeed({ sessionId, outputPath: "", finalText: CLOSING_ANSWER });
      }
      return Effect.sync(() => {
        const broken = brokenHandoffs.delete(phase);
        writeFileSync(
          join(options.cwd, ".phax-context", "phase-handoff.md"),
          broken ? "## What was delivered\n- Half a handoff.\n" : handoffOf(phase),
        );
        backend.onHandoff?.(phase, options.phaseFolderPath);
        return { sessionId, outputPath: "", finalText: "" };
      });
    },
    complete: unused,
    probe: unused,
    captureTranscript: ({ sessionId }) => {
      const text = backend.transcripts.get(sessionId);
      return Effect.succeed(
        text === undefined
          ? { status: "missing", reason: "not-found", detail: `no transcript for ${sessionId}` }
          : { status: "found", bytes: new TextEncoder().encode(text) },
      );
    },
  };
  return backend;
}

interface ShellCall {
  readonly line: string;
  readonly cwd: string | undefined;
}

const realShell = Effect.runSync(Effect.provide(Shell, NodeShellLayer));

// `pnpm …` steps are scripted and recorded, green unless in `failing`; every
// other command runs.
function scriptedShell(calls: ShellCall[], failing: ReadonlySet<string>) {
  return Layer.succeed(Shell, {
    run: (options) => {
      if (options.command[0] !== "pnpm") return realShell.run(options);
      const line = options.command.join(" ");
      calls.push({ line, cwd: options.cwd });
      const red = failing.has(line);
      return Effect.succeed({
        exitCode: red ? 1 : 0,
        stdout: "",
        stderr: red ? "1 failed: invoiceRow header" : "",
        stdoutEncoding: "utf8" as const,
      });
    },
  });
}

// ── Running ────────────────────────────────────────────────────────────────

export interface HeldRun {
  readonly world: HeldWorld;
  readonly plan: PhaxPlan;
  readonly planMd: string;
  readonly runPath: string;
  readonly runId: RunId;
  readonly backend: HeldBackend;
  readonly shellCalls: ShellCall[];
  /** Gate command lines (`pnpm typecheck`) that fail while they are in the set. */
  readonly failingGates: Set<string>;
  readonly lock: ReturnType<typeof makeFakeLock>;
  readonly closed: ClosedStop[];
  readonly config: ResolvedConfig;
  /** Every semantic event the run and its resumes recorded. */
  readonly telemetry: ReturnType<typeof makeFakeSystemTelemetry>;
  /** The host the run asks the repository's visibility of; private by default. */
  readonly github: ReturnType<typeof makeFakeGitHub>;
  /** An atomic write it returns true for fails, as a full disk would; none by default. */
  failWrite: ((path: string, content: string) => boolean) | undefined;
  readonly providerConfig: ProviderConfig;
}

export interface HeldRunOptions {
  readonly records?: boolean;
  /** Another providers.json; the default one with codex enabled by default. */
  readonly providerConfig?: ProviderConfig;
  /** Another made-up plan and its plan.md; the invoice-export plan by default. */
  readonly plan?: { readonly plan: PhaxPlan; readonly planMd: string };
  /** The configured oracles provider; none by default. */
  readonly oracles?: { readonly command: string };
}

/** Name a run of the invoice-export plan that records `hold`, without running it. */
async function createHeldRun(
  world: HeldWorld,
  hold: RunHold,
  opts: HeldRunOptions = {},
): Promise<HeldRun> {
  const shortName = Either.getOrThrow(decodeShortName(SHORT));
  const { plan, planMd } = opts.plan ?? invoiceExportPlan();
  const config = configOf(world, opts.records ?? false, opts.oracles);
  const { runPath, runId } = await Effect.runPromise(
    createRunFolder(shortName, planMd, plan, config, undefined, undefined, hold).pipe(
      Effect.provide(NodeFileSystemLayer),
    ),
  );
  return {
    world,
    plan,
    planMd,
    runPath,
    runId,
    backend: makeHeldBackend(),
    shellCalls: [],
    failingGates: new Set<string>(),
    lock: makeFakeLock(),
    closed: [],
    config,
    telemetry: makeFakeSystemTelemetry(),
    github: makeFakeGitHub(),
    failWrite: undefined,
    providerConfig: opts.providerConfig ?? HELD_PROVIDER_CONFIG,
  };
}

// The real file system, whose atomic writes fail where `run.failWrite` says.
function faultyFileSystem(run: HeldRun) {
  return Layer.effect(
    FileSystem,
    Effect.map(FileSystem, (fs) => ({
      ...fs,
      writeAtomic: (path: string, content: string) =>
        run.failWrite?.(path, content) === true
          ? Effect.fail(new FsError({ message: `${path}: no space left on device` }))
          : fs.writeAtomic(path, content),
    })),
  ).pipe(Layer.provide(NodeFileSystemLayer));
}

/** Run `executePlan` from `startIndex`, as `phax run` (0) or `phax resume --yes` does. */
function executeHeldRun(
  run: HeldRun,
  startIndex: number,
): Promise<Either.Either<unknown, unknown>> {
  const shortName = Either.getOrThrow(decodeShortName(SHORT));
  const program = withRunLock(
    RUN_KEY,
    executePlan({
      shortName,
      namespace: NAMESPACE,
      plan: run.plan,
      planMd: run.planMd,
      config: run.config,
      gateProfileId: "standard",
      allowDirty: false,
      runPath: run.runPath,
      runId: run.runId,
      startIndex,
      routing: DEFAULT_MODEL_ROUTING,
      providerConfig: run.providerConfig,
      onStopClosed: (closed) => run.closed.push(closed),
    }),
  );
  return Effect.runPromise(
    Effect.either(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(Backend, run.backend),
            faultyFileSystem(run),
            NodeGitLayer,
            scriptedShell(run.shellCalls, run.failingGates),
            run.telemetry.layer,
            run.github.layer,
            run.lock.layer,
            // The provider stores sit under the world's own HOME.
            providerStoreRootsUnder(run.world.home),
          ),
        ),
      ),
    ),
  );
}

/** Name a run that records `hold` and run it from its first phase. */
export async function startHeldRun(
  world: HeldWorld,
  hold: RunHold,
  opts: HeldRunOptions & { readonly prepare?: (run: HeldRun) => void } = {},
): Promise<{ run: HeldRun; result: Either.Either<unknown, unknown> }> {
  const run = await createHeldRun(world, hold, opts);
  opts.prepare?.(run);
  return { run, result: await executeHeldRun(run, 0) };
}

/** `phax resume --yes`: the start phase as the resume decision names it. */
export async function resumeHeldRun(run: HeldRun): Promise<Either.Either<unknown, unknown>> {
  const decision = await inspectResumeOnDisk(
    NAMESPACE,
    Either.getOrThrow(decodeShortName(SHORT)),
    run.world.stateRoot,
  );
  if (Either.isLeft(decision)) throw new Error(decision.left.message);
  return executeHeldRun(run, decision.right.nextPhaseIndex);
}

// ── Reading ────────────────────────────────────────────────────────────────

export const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

export const readRunStatus = (run: HeldRun): Record<string, unknown> =>
  readJson(join(run.runPath, "run-status.json"));

export const readPhaseStatus = (run: HeldRun, phaseId: string): Record<string, unknown> =>
  readJson(join(run.runPath, phaseId, "status.json"));

/** The backend calls, every one or those of one phase. */
export const backendCalls = (run: HeldRun, phaseId?: string): BackendCall[] =>
  phaseId === undefined ? run.backend.calls : run.backend.calls.filter((c) => c.phase === phaseId);

export const worktreeOf = (run: HeldRun, phaseId: string): string =>
  join(run.world.stateRoot, "worktrees", RUN_KEY, phaseId);

export const gitIn = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
