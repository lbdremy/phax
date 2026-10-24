import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { readExecutedHandoffs } from "../../src/app/interactiveFiles.js";
import { stopAtDeclaredPhase } from "../../src/app/interactiveStop.js";
import type { ClaudeSessionId, RunId } from "../../src/domain/branded.js";
import type { DeclaredStopReport } from "../../src/domain/errors.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl, withSchemaUrl } from "../../src/schemas/persisted.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { ProviderId } from "../../src/schemas/providerId.js";
import { encodeSecurityPosture } from "../../src/schemas/securityPosture.js";
import { isolateGit } from "./isolateGit.js";
import { phaseStatusFile } from "./phaseStatusFixture.js";
import { runStatus } from "./runStatusFixture.js";
import { disableGitAutoMaintenance, removeTempDir } from "./tempGit.js";

// A made-up world for the commands that act on a run awaiting review: one
// main repository and one state root, holding the invoice-export and
// credit-notes runs, each stopped at its interactive phase-03 by the real
// `stopAtDeclaredPhase` with the fake backend playing the provider. Real git
// (a linked worktree per run), the real file system.

export const NAMESPACE = "example";
export const SESSION_X1 = "X1" as ClaudeSessionId;

const RUN_CREATED = "2026-10-22T09:00:00.000Z";

export interface World {
  readonly root: string;
  readonly repoRoot: string;
  readonly stateRoot: string;
  /** Remove everything the world created. */
  cleanup(): void;
}

export interface StoppedRun {
  readonly world: World;
  readonly shortName: string;
  readonly runKey: string;
  readonly runId: string;
  readonly runPath: string;
  readonly phaseFolder: string;
  readonly worktree: string;
  readonly report: DeclaredStopReport;
  readonly backend: ReturnType<typeof makeFakeBackend>;
  readonly policy: SecurityPolicy;
}

/** A temporary repository, git isolated from the person's configuration until `cleanup` (isolateGit). */
export function createWorld(): World {
  const restoreGit = isolateGit();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-stopped-run-test-")));
  const repoRoot = join(root, "repo");
  const stateRoot = join(root, "state");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(repoRoot);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  writeFileSync(join(repoRoot, ".gitignore"), ".phax-context/\n");
  mkdirSync(join(repoRoot, "src"));
  writeFileSync(join(repoRoot, "src", "invoiceRow.ts"), "export const header = 'invoice_no';\n");
  mkdirSync(join(repoRoot, "docs"));
  writeFileSync(join(repoRoot, "docs", "notes.md"), "# Export notes\n");
  git("add", "-A");
  git("commit", "-m", "feat(export): invoice CSV record");
  const cleanup = (): void => {
    removeTempDir(root);
    restoreGit();
  };
  return { root, repoRoot, stateRoot, cleanup };
}

function planPhase(id: string, title: string, mode: "headless" | "interactive"): PhaxPlanPhase {
  return {
    id,
    title,
    model: "claude-sonnet-5-5",
    effort: "medium",
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: [],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode,
    oracle: null,
    commit: { subject: `feat(export): ${title.toLowerCase()}`, body: "Made-up body." },
  };
}

const phases: readonly PhaxPlanPhase[] = [
  planPhase("phase-01", "Export port", "headless"),
  planPhase("phase-02", "Invoice CSV record", "headless"),
  planPhase("phase-03", "Review the export record", "interactive"),
  planPhase("phase-04", "Credit notes export", "headless"),
];

const planSections = new Map<string, string>(
  phases.map((p) => [p.id, `## ${p.id} — ${p.title}\n\nMade-up instructions.`]),
);

export const FIRST_READING = {
  $schema: currentSchemaUrl("first-reading"),
  pattern: ["The InvoiceRow column order"],
  copiedBy: [{ phase: "phase-04", what: "the column order" }],
  toCheck: ["Whether `invoice_no` should read `Invoice number`"],
};

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export interface StopRunOptions {
  readonly shortName?: string;
  readonly provider?: ProviderId;
  readonly model?: string;
  /** The first turn's session id; undefined makes the first turn fail with a rate limit. */
  readonly sessionId?: string | undefined;
}

/**
 * Set up `shortName` (default invoice-export) with phase-01 and phase-02
 * committed and phase-03 interactive, then stop it at phase-03.
 */
export async function stopRun(world: World, options: StopRunOptions = {}): Promise<StoppedRun> {
  const shortName = options.shortName ?? "invoice-export";
  const provider = options.provider ?? "claude-code";
  const model = options.model ?? "claude-sonnet-5-5";
  const sessionId = "sessionId" in options ? options.sessionId : SESSION_X1;
  const runKey = `${NAMESPACE}.${shortName}`;
  const runId = `${shortName}-1792667922832`;
  const runPath = join(world.stateRoot, "runs", runKey);
  const phaseFolder = join(runPath, "phase-03");
  const worktree = join(world.stateRoot, "worktrees", runKey, "phase-03");
  const branch = `phax/${shortName}--phase-03`;

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: world.repoRoot, stdio: "pipe" }).toString().trim();
  const base = git("rev-parse", "HEAD");
  mkdirSync(join(worktree, ".."), { recursive: true });
  git("worktree", "add", "-b", branch, worktree, "HEAD");
  mkdirSync(join(worktree, ".phax-context"), { recursive: true });
  writeFileSync(join(worktree, ".phax-context", "plan.md"), "# Invoice export\n");

  writeJson(
    join(runPath, "run-status.json"),
    withSchemaUrl(
      "run-status",
      runStatus({
        namespace: NAMESPACE,
        shortName,
        runId,
        state: "running",
        createdAt: RUN_CREATED,
        updatedAt: RUN_CREATED,
        phasesCount: 4,
        currentPhaseIndex: 2,
      }),
    ),
  );
  for (const [index, id] of ["phase-01", "phase-02"].entries()) {
    writeJson(
      join(runPath, id, "status.json"),
      phaseStatusFile({
        phaseId: id,
        phaseIndex: index,
        state: "committed",
        model: "claude-sonnet-5-5",
        effort: "medium",
        branchName: `phax/${shortName}--${id}`,
        base,
        commitHash: base,
        createdAt: RUN_CREATED,
        updatedAt: RUN_CREATED,
      }),
    );
    writeFileSync(join(runPath, id, "phase-handoff.md"), `## What was delivered\n- ${id}.\n`);
  }
  writeJson(
    join(phaseFolder, "status.json"),
    phaseStatusFile({
      phaseId: "phase-03",
      phaseIndex: 2,
      state: "running",
      model: model,
      effort: "medium",
      branchName: branch,
      base,
      worktreePath: worktree,
      createdAt: RUN_CREATED,
      updatedAt: RUN_CREATED,
      mode: "interactive",
    }),
  );

  const policy: SecurityPolicy = {
    mode: "secure",
    filesystem: {
      allowRead: [worktree],
      allowWrite: [worktree, join(world.root, "home", ".phax")],
    },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: ["pnpm test"],
    failClosed: true,
  };
  writeJson(join(phaseFolder, "model-resolution.json"), {
    requested: { model: "claude-sonnet-5-5", family: "claude-sonnet", effort: "medium" },
    selected: {
      provider,
      family: provider === "codex-cli" ? "openai-gpt" : "claude-sonnet",
      thinking: "medium",
      concreteModel: model,
    },
    relationship: "exact",
    reason: "made-up",
  });
  writeJson(
    join(phaseFolder, "security.json"),
    encodeSecurityPosture({
      version: 2,
      mode: "secure",
      provider,
      sandboxEnabled: true,
      filesystem: policy.filesystem,
      network: policy.network,
      mcp: policy.mcp,
      downgraded: false,
      marks: [],
      agentCommands: [
        {
          command: "pnpm test",
          source: "gate",
          explicit: false,
          requiredByPlan: false,
          enforcement: "prefix",
          degraded: false,
        },
      ],
      skillEditGrants: [],
      providerSkippedForSecurity: [],
      stop: null,
    }),
  );

  const backend = makeFakeBackend();
  if (sessionId === undefined) {
    backend.impl.failRunWithRateLimit(0, { kind: "rate_limit", resetAt: "2026-10-22T14:20:00Z" });
  } else {
    backend.impl.addRunResponse({
      sessionId: sessionId as ClaudeSessionId,
      outputPath: "",
      finalText: JSON.stringify(FIRST_READING),
    });
  }
  const executedHandoffs = await Effect.runPromise(
    readExecutedHandoffs(runPath, phases, 2).pipe(Effect.provide(NodeFileSystemLayer)),
  );
  const report = await Effect.runPromise(
    stopAtDeclaredPhase({
      runId: runId as RunId,
      shortName,
      runPath,
      mainCheckout: world.repoRoot,
      phases,
      phase: phases[2]!,
      phaseIndex: 2,
      phaseFolder,
      worktree,
      provider,
      model,
      effort: "medium",
      providerEntry: DEFAULT_PROVIDER_CONFIG.providers[provider],
      policy,
      agentCommands: ["pnpm test"],
      gateCommands: ["pnpm typecheck", "pnpm test"],
      planSections,
      executedHandoffs,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          backend.layer,
          NodeFileSystemLayer,
          NodeGitLayer,
          makeFakeShell().layer,
          NoopSystemTelemetryLayer,
        ),
      ),
    ),
  );
  return {
    world,
    shortName,
    runKey,
    runId,
    runPath,
    phaseFolder,
    worktree,
    report,
    backend,
    policy,
  };
}

/** Write registry.json listing `runs`, so `phax ls` finds them. */
export function writeRegistry(world: World, runs: readonly StoppedRun[]): void {
  writeJson(join(world.stateRoot, "registry.json"), {
    $schema: currentSchemaUrl("registry"),
    runs: runs.map((run) => ({
      namespace: NAMESPACE,
      shortName: run.shortName,
      runId: run.runId,
      state: "awaiting_review",
      branch: `phax/${run.shortName}`,
      projectName: NAMESPACE,
      phasesCount: 4,
      createdAt: RUN_CREATED,
      updatedAt: RUN_CREATED,
    })),
  });
}

/** The project config a command sees when it runs from the world's main checkout. */
export function resolvedConfig(world: World): ResolvedConfig {
  return {
    raw: {} as never,
    namespace: NAMESPACE,
    stateRoot: world.stateRoot,
    repoRoot: world.repoRoot,
    maxFixAttempts: 3,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    security: {
      profile: "secure",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    publish: {
      auto: false,
      remote: "origin",
      provider: "github",
      pushBranch: true,
      createPullRequest: true,
    },
    complianceReview: { enabled: false, model: "claude-sonnet-4-6", effort: "medium" },
    codeReview: { model: "claude-opus-5-5", effort: "high" },
    authoring: {
      spec: { model: "claude-opus-5-5", effort: "high" },
      plan: { model: "claude-opus-5-5", effort: "high" },
    },
    records: {
      enabled: false,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
  };
}

/** Patch the keys of a JSON document in place. */
export function patchJson(path: string, patch: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify({ ...readJson(path), ...patch }, null, 2));
}
