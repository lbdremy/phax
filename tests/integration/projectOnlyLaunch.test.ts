import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { authorArtifact, type AuthorArtifactInput } from "../../src/app/authorArtifact.js";
import { decideArtifact } from "../../src/app/decideArtifact.js";
import { seedPaths, writeSeed } from "../../src/app/interactiveFiles.js";
import { runFirstTurn } from "../../src/app/interactiveStop.js";
import { reviewCodeHeadless } from "../../src/app/reviewCode.js";
import { reviewCompliance } from "../../src/app/reviewCompliance.js";
import type { BranchName, RunId } from "../../src/domain/branded.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import type { ProviderId, RoutingResolution } from "../../src/domain/routing/types.js";
import type { RunReviewInfo } from "../../src/domain/runReviewInfo.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakePrompt } from "../../src/infra/fakes/prompt.js";
import { makeFakeSession } from "../../src/infra/fakes/session.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { NodeFileSystemLayer, makeRootedNodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { runClaudeAgent, runClaudeCompletion } from "../../src/infra/providers/claudeCode.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { AgentRunOptions } from "../../src/ports/backend.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";
import type { ResolvedSecurityConfig } from "../../src/schemas/securityConfig.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import { SPEC_FRONTMATTER, KEPT_SESSION, useDecideRepo } from "../helpers/decideVerdictsHarness.js";
import {
  expectAutoMemoryOff,
  expectProjectOnly,
  flagValue,
  phaseScripts,
  runHeadlessPlan,
  SESSION,
  useFakeClaude,
} from "../helpers/projectOnlyHarness.js";
import { disableGitAutoMaintenance } from "../helpers/tempGit.js";
import { FILE_VALID, SPEC, SPEC_PATH } from "../unit/decide/verdictsFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// Acceptance for project-only launches: every headless Claude Code session
// phax starts carries `--setting-sources project` in its argv and
// CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 in its environment, a resume included, and
// phax's value wins over the operator's. Each launch kind is reached through
// its own entry point over the real node backend and the recording stub; only
// the stub's log, its argv and its whole environment, is judged. Every spec,
// plan and operator is made up.

const world = useDecideRepo();
const fake = useFakeClaude();

const PROSE = { sessionId: SESSION, finalText: "No answer, only prose." } as const;

const securePolicy = (writable: string): SecurityPolicy => ({
  mode: "secure",
  filesystem: { allowRead: [writable], allowWrite: [writable] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
  failClosed: true,
});

const unsafePolicy: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open" },
  mcp: { mode: "provider-default", allow: [] },
  agentCommands: [],
  failClosed: false,
};

const sessionOptions = (security: SecurityPolicy, extra: Partial<AgentRunOptions> = {}) =>
  ({
    provider: "claude-code",
    model: "claude-sonnet-5-5",
    effort: "medium",
    cwd: fake.root,
    security,
    ...extra,
  }) satisfies AgentRunOptions;

const providerConfig = (): ProviderConfig => ({
  providers: {
    "claude-code": { enabled: true, executable: "claude" },
    "codex-cli": {
      ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!,
      enabled: true,
      executable: fake.cli.codexPath,
    },
  },
});

const backendLayer = () => makeNodeBackendLayer(providerConfig());

function resolutionOn(model: string): RoutingResolution {
  return {
    requested: { model, family: "claude-opus", effort: "high" },
    selected: {
      provider: "claude-code" satisfies ProviderId,
      family: "claude-opus",
      concreteModel: model,
      thinking: "high",
    },
    relationship: "exact",
    reason: "exact match",
  };
}

const authoringSecurity: ResolvedSecurityConfig = {
  profile: "secure",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
};

const recordsOff: ResolvedRecordsConfig = {
  enabled: false,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

// ── The launch kinds that need a world of their own ────────────────────────

// Headless spec authoring. The answer is refused: only the spawns are of interest.
async function driveAuthoring(): Promise<void> {
  const repoRoot = join(fake.root, "repo");
  mkdirSync(join(repoRoot, "docs", "specs"), { recursive: true });
  mkdirSync(join(fake.root, "state"), { recursive: true });
  const git = makeFakeGit();
  git.impl.setHeadCommit("3e9a1c4d".repeat(5));
  const input: AuthorArtifactInput = {
    kind: "spec",
    slug: "widget-export",
    brief: { text: "Export widgets.\n", path: "brief.md" },
    sourceSpec: null,
    completion: { last: false, notLast: false },
    model: "claude-opus-5-5",
    effort: "high",
    resolution: resolutionOn("claude-opus-5-5"),
    skillText: "# phax-spec skill\n",
    security: authoringSecurity,
    repoRoot,
    stateRoot: join(fake.root, "state"),
    extractPlanModel: "claude-sonnet-5",
    extractPlanEffort: "medium",
    nowIso: "2026-10-30T14:12:00.000Z",
    records: recordsOff,
    publishRemote: "origin",
    architectureProvider: false,
    assignmentBounds: false,
    acceptanceProvider: false,
    output: { warn: () => undefined },
  };
  await Effect.runPromise(
    Effect.either(
      authorArtifact(input).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeRootedNodeFileSystemLayer(repoRoot),
            git.layer,
            makeFakeGitHub().layer,
            backendLayer(),
          ),
        ),
      ),
    ),
  );
}

function reviewInfo(runPath: string, worktreePath: string): RunReviewInfo {
  return {
    namespace: "test-project",
    shortName: "my-run",
    runId: "my-run-001",
    runState: "review_open",
    branch: "feature/my-run",
    runTitle: "My Run",
    finalPhaseBranch: "feature/my-run--phase-01" as BranchName,
    stateRoot: dirname(dirname(runPath)),
    runPath,
    finalPhaseId: "phase-01",
    finalPhaseTitle: "Phase 01",
    worktreePath,
    claudeSessionId: undefined,
    gateProfileId: "full",
    phaseStatuses: [],
    planPhases: [{ id: "phase-01", title: "Phase 01" }],
    updatedAt: "2026-10-27T11:00:00.000Z",
    stoppedReason: undefined,
    lastError: undefined,
  };
}

async function driveCodeReview(): Promise<void> {
  const runPath = join(fake.root, "review-state", "runs", "my-run");
  const worktreePath = join(fake.root, "review-worktree");
  mkdirSync(runPath, { recursive: true });
  mkdirSync(worktreePath, { recursive: true });
  await Effect.runPromise(
    Effect.either(
      reviewCodeHeadless(
        reviewInfo(runPath, worktreePath),
        { enabled: false, model: "claude-opus-5-5", effort: "high" },
        resolutionOn("claude-opus-5-5"),
        { mode: "secure", config: authoringSecurity },
        {
          bundledReviewSkill: "---\nname: phax-review\n---\n\n# Bundled doctrine\n",
          nowIso: "2026-10-27T12:00:00.000Z",
          output: { log() {}, warn() {}, error() {} },
        },
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeFakeFileSystem().layer,
            makeFakeGit().layer,
            makeFakeGitHub().layer,
            backendLayer(),
            NoopSystemTelemetryLayer,
          ),
        ),
      ),
    ),
  );
}

async function driveComplianceReview(): Promise<void> {
  const runPath = join(fake.root, "compliance-state", "runs", "my-run");
  const worktreePath = join(fake.root, "compliance-worktree");
  mkdirSync(runPath, { recursive: true });
  mkdirSync(worktreePath, { recursive: true });
  const fs = makeFakeFileSystem();
  fs.impl.setFile(join(runPath, "plan.md"), "# Made-up plan\n");
  fs.impl.setFile(join(runPath, "global-file-reconciliation.md"), "# Reconciliation\n");
  await Effect.runPromise(
    Effect.either(
      reviewCompliance(
        reviewInfo(runPath, worktreePath),
        { enabled: true, model: "claude-opus-5-5", effort: "high" },
        resolutionOn("claude-opus-5-5"),
        { mode: "secure", config: authoringSecurity },
        { output: { log() {}, warn() {}, error() {} } },
      ).pipe(Effect.provide(Layer.mergeAll(fs.layer, backendLayer(), NoopSystemTelemetryLayer))),
    ),
  );
}

// The first turn of an interactive phase: a headless session that reads the
// phase and leaves the person in a continue command.
async function driveFirstTurn(): Promise<void> {
  const worktree = join(fake.root, "worktree");
  const phaseFolder = join(fake.root, "runs", "invoice-export", "phase-03");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(phaseFolder, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: worktree, stdio: "pipe" });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(worktree);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  writeFileSync(join(worktree, ".gitignore"), ".phax-context/\n");
  writeFileSync(join(worktree, "invoiceRow.ts"), "export const header = 'invoice_no';\n");
  git("add", "-A");
  git("commit", "-m", "base");
  const policy: SecurityPolicy = {
    mode: "secure",
    filesystem: { allowRead: [], allowWrite: [] },
    network: { profile: "open" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
    failClosed: true,
  };
  const program = Effect.gen(function* () {
    yield* writeSeed(seedPaths(worktree, phaseFolder), "# Interactive review: phase-03\n");
    return yield* runFirstTurn({
      runId: "invoice-export-1792667922832" as RunId,
      runPath: join(fake.root, "runs", "invoice-export"),
      phaseFolder,
      worktree,
      phase: { id: "phase-03" },
      provider: "claude-code",
      model: "claude-sonnet-5-5",
      effort: "medium",
      policy,
      origin: "first-turn",
    });
  });
  await Effect.runPromise(
    Effect.either(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            backendLayer(),
            NodeFileSystemLayer,
            NodeGitLayer,
            NoopSystemTelemetryLayer,
          ),
        ),
      ),
    ),
  );
}

// decide --verdicts: the writer, a new headless session of the authoring
// folder's spec.
async function driveDecideWriter(): Promise<void> {
  const authoringId = "2610250900-log-rotation";
  const specJson = SPEC_PATH.replace(/\.md$/, ".json");
  world.writeRepoFile(SPEC_PATH, SPEC_FRONTMATTER + renderSpecBody(SPEC.document as SpecDocument));
  world.writeRepoFile(specJson, serializeSidecar(SPEC));
  world.writeRepoFile("verdicts.json", FILE_VALID);
  world.commitAll();
  const folder = join(world.stateRoot, "authoring", authoringId);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "session.json"),
    JSON.stringify({
      version: 1,
      provider: "claude-code",
      sessionId: SESSION,
      retrySessionId: KEPT_SESSION,
      cwd: "/somewhere/else",
    }),
  );
  const h = world.harness({ backendLayer: backendLayer() });
  await h.run({
    model: "claude-opus-5-5",
    providerConfig: providerConfig(),
    routing: DEFAULT_MODEL_ROUTING,
  });
}

// decide on a hand-authored spec: the interactive session (the fake Session
// port), then the handback, a resume of that session on Claude Code, and its
// corrective retry when the handback's answer is refused.
const HAND_SPEC_PATH = "docs/specs/2610161030-log-retention.md";
const HAND_SPEC = [
  "---",
  "status: Draft",
  "date: 2026-10-16",
  "audience: maintainers",
  "scope: logs",
  "---",
  "# Log retention",
  "",
  "## 1. Context",
  "",
  "Every run writes one log.",
  "",
  "## 9. Open questions",
  "",
  "### Q1 — Logs: kept per run, or rotated daily?",
  "",
  "- per-run — Kept per run — abandons: a bounded log directory",
  "- daily — Rotated daily — abandons: one log per run",
  "",
  "Recommendation: per-run — a report names its run",
  "",
].join("\n");

async function driveHandDecide(): Promise<void> {
  world.writeRepoFile(HAND_SPEC_PATH, HAND_SPEC);
  world.commitAll();
  await Effect.runPromise(
    Effect.either(
      decideArtifact({
        path: HAND_SPEC_PATH,
        question: null,
        doctrinePath: null,
        model: undefined,
        effort: undefined,
        bundledSkills: { spec: "- `S1` Adopt it.\n", plan: "- `P1` Split it.\n" },
        security: authoringSecurity,
        repoRoot: world.repoDir,
        stateRoot: world.stateRoot,
        extractPlanModel: "claude-haiku-5-5",
        extractPlanEffort: "low",
        nowIso: "2026-10-30T14:12:00.000Z",
        records: recordsOff,
        publishRemote: "origin",
        output: { log() {}, warn() {} },
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeRootedNodeFileSystemLayer(world.repoDir),
            NodeGitLayer,
            backendLayer(),
            makeFakeSession().layer,
            makeFakePrompt([true]).layer,
            makeFakeTerminal(true).layer,
            makeFakeGitHub().layer,
          ),
        ),
      ),
    ),
  );
}

// ── ac-phase-argv ──────────────────────────────────────────────────────────

describe("ac-phase-argv", () => {
  it(
    "a secure claude-code phase session carries --setting-sources project and CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
    { timeout: 60_000 },
    async () => {
      fake.cli.setScripts([...phaseScripts("phase-01", SESSION, { fix: false })]);

      const run = await runHeadlessPlan(fake, {
        phases: [{ id: "phase-01", model: "claude-opus-5-5" }],
        gate: "pass",
        records: false,
      });

      expect(Either.isRight(run.result)).toBe(true);
      const [work] = fake.claudeLaunches();
      expect(work).toBeDefined();
      expect(work?.argv).not.toContain("--resume");
      expectProjectOnly(work?.argv ?? [], work?.env ?? {});
    },
  );
});

// ── ac-every-headless ──────────────────────────────────────────────────────

interface LaunchKind {
  readonly name: string;
  /** Reaches the kind's spawn(s) through its entry point; the stub is scripted already. */
  readonly drive: () => Promise<unknown>;
}

const KINDS: readonly LaunchKind[] = [
  {
    name: "a read-only session",
    drive: () =>
      Effect.runPromise(
        Effect.either(
          runClaudeAgent("ask", sessionOptions(securePolicy(fake.root), { readOnly: true })),
        ),
      ),
  },
  {
    name: "a secure session",
    drive: () =>
      Effect.runPromise(
        Effect.either(runClaudeAgent("ask", sessionOptions(securePolicy(fake.root)))),
      ),
  },
  {
    name: "an unsafe session",
    drive: () =>
      Effect.runPromise(Effect.either(runClaudeAgent("ask", sessionOptions(unsafePolicy)))),
  },
  {
    name: "a structured completion",
    drive: () =>
      Effect.runPromise(
        Effect.either(
          runClaudeCompletion("ask", {
            provider: "claude-code",
            model: "claude-sonnet-5-5",
            effort: "medium",
            cwd: fake.root,
          }),
        ),
      ),
  },
  { name: "headless spec authoring", drive: driveAuthoring },
  {
    name: "handoff generation",
    drive: async () => {
      fake.cli.setScripts([...phaseScripts("phase-01", SESSION, { fix: false })]);
      await runHeadlessPlan(fake, {
        phases: [{ id: "phase-01", model: "claude-opus-5-5" }],
        gate: "pass",
        records: false,
      });
    },
  },
  { name: "headless code review", drive: driveCodeReview },
  { name: "compliance review", drive: driveComplianceReview },
  { name: "the first turn of an interactive phase", drive: driveFirstTurn },
  { name: "the decide verdicts writer", drive: driveDecideWriter },
];

describe("ac-every-headless", () => {
  it.each(KINDS)(
    "$name launches with --setting-sources project and CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
    { timeout: 60_000 },
    async ({ name, drive }) => {
      // Unless a kind scripts the stub itself (a whole run does), every answer
      // is prose: only the launches are of interest.
      if (name !== "handoff generation") fake.cli.setScript(PROSE);

      await drive();

      const launches = fake.claudeLaunches();
      expect(launches.length).toBeGreaterThan(0);
      // The handoff is the last launch of its run: the work turn is judged by ac-phase-argv.
      const judged = name === "handoff generation" ? launches.slice(-1) : launches;
      for (const launch of judged) expectProjectOnly(launch.argv, launch.env);
    },
  );
});

// ── ac-memory-wins ─────────────────────────────────────────────────────────

describe("ac-memory-wins", () => {
  it("a headless session still gets CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 when phax is run with 0", async () => {
    vi.stubEnv("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "0");
    fake.cli.setScript(PROSE);

    await Effect.runPromise(
      Effect.either(runClaudeAgent("ask", sessionOptions(securePolicy(fake.root)))),
    );

    const [launch] = fake.claudeLaunches();
    expect(launch).toBeDefined();
    expectAutoMemoryOff(launch?.env ?? {});
  });

  it("a sealed completion still gets CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 when phax is run with false", async () => {
    vi.stubEnv("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "false");
    fake.cli.setScript(PROSE);

    await Effect.runPromise(
      Effect.either(
        runClaudeCompletion("ask", {
          provider: "claude-code",
          model: "claude-sonnet-5-5",
          effort: "medium",
          cwd: fake.root,
        }),
      ),
    );

    const [launch] = fake.claudeLaunches();
    expect(launch).toBeDefined();
    expectAutoMemoryOff(launch?.env ?? {});
  });
});

// ── ac-resume ──────────────────────────────────────────────────────────────

describe("ac-resume", () => {
  it(
    "a phase fix attempt resumes the first session and launches project-only",
    { timeout: 60_000 },
    async () => {
      fake.cli.setScripts([...phaseScripts("phase-01", SESSION, { fix: true })]);

      const run = await runHeadlessPlan(fake, {
        phases: [{ id: "phase-01", model: "claude-opus-5-5" }],
        gate: "fail-once",
        records: false,
      });

      expect(Either.isRight(run.result)).toBe(true);
      // The work turn, the fix attempt, then the handoff turn.
      const [work, fix] = fake.claudeLaunches();
      expect(fake.claudeLaunches()).toHaveLength(3);
      expect(work?.argv).not.toContain("--resume");
      expect(flagValue(fix?.argv ?? [], "--resume")).toBe(SESSION);
      expectProjectOnly(fix?.argv ?? [], fix?.env ?? {});
    },
  );

  it(
    "a decide handback and its corrective retry each resume a session and launch project-only",
    { timeout: 60_000 },
    async () => {
      // The handback's first answer is not an answer; the retry's is no better:
      // the spawns are what is judged.
      fake.cli.setScript(PROSE);

      await driveHandDecide();

      const [handback, retry, ...more] = fake.claudeLaunches();
      expect(more).toEqual([]);
      expect(handback).toBeDefined();
      expect(retry).toBeDefined();
      for (const launch of [handback, retry]) {
        expect(flagValue(launch?.argv ?? [], "--resume")).toEqual(expect.any(String));
        expectProjectOnly(launch?.argv ?? [], launch?.env ?? {});
      }
    },
  );
});
