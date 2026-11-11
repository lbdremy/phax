import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result, Layer } from "effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName, type RunId } from "../../src/domain/branded.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import { makeFakeProviderCli, type FakeProviderCli } from "./fakeProviderCli.js";
import { isolateGit } from "./isolateGit.js";
import { processOutput } from "./processOutput.js";
import { disableGitAutoMaintenance, removeTempDir } from "./tempGit.js";

// The shared setup of the project-only acceptance tests. Every Claude Code
// session phax launches headless must carry `--setting-sources project` in its
// argv and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in its environment. The tests
// judge only what the recording stub (tests/helpers/fakeProviderCli.ts) logs
// per invocation, argv and the whole environment, and the committed records.

/** One launch of the fake `claude` or `codex`: its argv and the environment it ran in. */
interface Launch {
  readonly executable: "claude" | "codex";
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export type FakeScript = Parameters<FakeProviderCli["setScript"]>[0];

export const SESSION = "3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42";

const HANDOFF = (phaseId: string): string =>
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

/** The recording stub installed for one test, its environment put on process.env. */
export interface FakeClaude {
  readonly root: string;
  readonly cli: FakeProviderCli;
  /** Every invocation so far, in order, with the environment it ran in. */
  launches(): readonly Launch[];
  /** The launches of the `claude` executable alone. */
  claudeLaunches(): readonly Launch[];
}

/**
 * Registers the per-test world: a fresh temporary directory holding the
 * recording stub, git isolated from the person's configuration, and the stub's
 * variables (PATH, HOME, the three log files) stubbed over process.env. Values
 * are read through the returned object: they change from test to test.
 */
export function useFakeClaude(): FakeClaude {
  let root = "";
  let cli: FakeProviderCli | undefined;
  let restoreGit: (() => void) | undefined;

  beforeEach(() => {
    restoreGit = isolateGit();
    root = realpathSync(mkdtempSync(join(tmpdir(), "phax-project-only-")));
    cli = makeFakeProviderCli(join(root, "cli"));
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    removeTempDir(root);
    restoreGit?.();
  });

  const current = (): FakeProviderCli => {
    if (cli === undefined) throw new Error("the recording stub is installed in beforeEach");
    return cli;
  };
  const launches = (): readonly Launch[] => {
    const stub = current();
    const traces = stub.traces();
    return stub.invocations().map((call, index) => ({
      executable: call.executable,
      argv: call.argv,
      cwd: call.cwd,
      env: traces[index]?.env ?? {},
    }));
  };
  return {
    get root() {
      return root;
    },
    get cli() {
      return current();
    },
    launches,
    claudeLaunches: () => launches().filter((launch) => launch.executable === "claude"),
  };
}

/** `--setting-sources` immediately followed by `project`, exactly once. */
function expectSettingSourcesProject(argv: readonly string[]): void {
  const at = argv.indexOf("--setting-sources");
  expect(at, `--setting-sources in ${argv.join(" ")}`).toBeGreaterThanOrEqual(0);
  expect(argv[at + 1]).toBe("project");
  expect(argv.filter((arg) => arg === "--setting-sources")).toHaveLength(1);
}

/** Claude Code's auto-memory is off in the session's environment. */
export function expectAutoMemoryOff(env: Readonly<Record<string, string>>): void {
  expect(env["CLAUDE_CODE_DISABLE_AUTO_MEMORY"]).toBe("1");
}

/** A headless launch: project settings only in the argv, auto-memory off in the environment. */
export function expectProjectOnly(
  argv: readonly string[],
  env: Readonly<Record<string, string>>,
): void {
  expectSettingSourcesProject(argv);
  expectAutoMemoryOff(env);
}

/** The value of `flag` in an argv, or undefined. */
export function flagValue(argv: readonly string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx < 0 ? undefined : argv[idx + 1];
}

// ── A run of a made-up headless plan, through executePlan ───────────────────

const NAMESPACE = "example";
const RUN_SHORT = "invoice-export";

// Fails its first run in a worktree and passes from then on, so the phase has a
// work turn, a fix turn and a handoff turn.
const FAIL_ONCE_GATE = [
  'import { existsSync, mkdirSync, writeFileSync } from "node:fs";',
  'const marker = ".phax-context/gate-ran";',
  "if (existsSync(marker)) {",
  '  console.log("gate: pass");',
  "} else {",
  '  mkdirSync(".phax-context", { recursive: true });',
  '  writeFileSync(marker, "");',
  '  console.error("gate: the invoice header is missing");',
  "  process.exitCode = 1;",
  "}",
  "",
].join("\n");

const PASSING_GATE = 'console.log("gate: pass");\n';

interface PlannedPhase {
  readonly id: string;
  readonly model: string;
}

export interface PlanRunOptions {
  readonly phases: readonly PlannedPhase[];
  /** A gate that fails each worktree's first run (a fix attempt follows), or one that always passes. */
  readonly gate: "fail-once" | "pass";
  /** Phase records on the records branch of the repository. */
  readonly records: boolean;
}

export interface PlanRun {
  readonly repoRoot: string;
  readonly runId: RunId;
  readonly result: Result.Result<unknown, unknown>;
}

function planOf(phases: readonly PlannedPhase[]): { plan: PhaxPlan; planMd: string } {
  const planned = phases.map(
    (phase, index): PhaxPlanPhase => ({
      id: phase.id,
      title: `Export step ${index + 1}`,
      model: phase.model,
      effort: "medium",
      planMarkdownAnchor: `#${phase.id}`,
      plannedFilesToCreate: [`src/${phase.id}.ts`],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      mode: "headless",
      acceptance: null,
      testLines: [],
      commit: { subject: `feat(export): step ${index + 1}`, body: "Made-up body." },
    }),
  );
  const plan = {
    run: {
      shortName: RUN_SHORT,
      title: "Invoice export",
      branch: `phax/${RUN_SHORT}`,
      requiredCommands: [],
    },
    phases: planned as unknown as PhaxPlan["phases"],
  } satisfies PhaxPlan;
  const planMd = [
    "# Invoice export",
    "",
    "## Required commands",
    "",
    "- (none)",
    "",
    ...planned.flatMap((phase) => [
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

function configOf(repoRoot: string, stateRoot: string, options: PlanRunOptions): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: stateRoot },
      gateProfiles: {
        standard: [
          {
            command: "node scripts/gate.mjs",
            surface: "local",
            firing: "every-phase",
            output: "log",
          },
        ],
      },
    },
    stateRoot,
    namespace: NAMESPACE,
    repoRoot,
    maxFixAttempts: 2,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low",
    fileReconciliationMode: "report_only",
    records: {
      enabled: options.records,
      transcript: false,
      destination: { kind: "in-repo" },
      autoPush: false,
    },
    security: {
      profile: "secure",
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

/** Claude Code and Codex enabled, both run by the recording stub. */
function providerConfigOf(cli: FakeProviderCli): ProviderConfig {
  const base = DEFAULT_PROVIDER_CONFIG.providers;
  return {
    providers: {
      "claude-code": { ...base["claude-code"]!, enabled: true },
      "codex-cli": { ...base["codex-cli"]!, enabled: true, executable: cli.codexPath },
      "mistral-vibe": { ...base["mistral-vibe"]!, enabled: false },
    },
  } as ProviderConfig;
}

/**
 * Runs a made-up headless plan end to end: real git on a temporary repository,
 * the real node backend over the recording stub, the secure profile and a gate
 * that runs `node scripts/gate.mjs`. The caller scripts the stub beforehand,
 * one script per provider turn in the order phax spawns them.
 */
export async function runHeadlessPlan(fake: FakeClaude, options: PlanRunOptions): Promise<PlanRun> {
  const repoRoot = join(fake.root, "repo");
  const stateRoot = join(fake.root, "state");
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  mkdirSync(join(repoRoot, "scripts"), { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(repoRoot);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  writeFileSync(join(repoRoot, ".gitignore"), ".phax-context/\n");
  writeFileSync(join(repoRoot, "src", "keep.ts"), "export const keep = 1;\n");
  writeFileSync(
    join(repoRoot, "scripts", "gate.mjs"),
    options.gate === "fail-once" ? FAIL_ONCE_GATE : PASSING_GATE,
  );
  git("add", "-A");
  git("commit", "-m", "chore: start");

  const { plan, planMd } = planOf(options.phases);
  const shortName = Result.getOrThrow(decodeShortName(RUN_SHORT));
  const config = configOf(repoRoot, stateRoot, options);
  const { runPath, runId } = await Effect.runPromise(
    createRunFolder(shortName, planMd, plan, config).pipe(Effect.provide(NodeFileSystemLayer)),
  );
  const providerConfig = providerConfigOf(fake.cli);
  const result = await Effect.runPromise(
    Effect.result(
      executePlan({
        phaxVersion: "0.0.0-test",
        output: processOutput,
        shortName,
        namespace: NAMESPACE,
        plan,
        planMd,
        config,
        gateProfileId: "standard",
        allowDirty: false,
        runPath,
        runId,
        startIndex: 0,
        // Under the default priority Codex comes first: a gpt model runs on it
        // natively, and so does a Claude Sonnet model through the equivalence
        // table. Claude Opus 5.5 has no Codex route, so it stays on Claude Code.
        routing: DEFAULT_MODEL_ROUTING,
        providerConfig,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeNodeBackendLayer(providerConfig),
            NodeFileSystemLayer,
            NodeGitLayer,
            NodeShellLayer,
            NoopSystemTelemetryLayer,
            makeFakeGitHub().layer,
          ),
        ),
      ),
    ),
  );
  return { repoRoot, runId, result };
}

/**
 * The scripts of one phase on one provider: its work turn, its fix turn when
 * the gate fails once, and its handoff turn.
 */
export function phaseScripts(
  phaseId: string,
  sessionId: string,
  options: { readonly fix: boolean },
): readonly FakeScript[] {
  const work: FakeScript = {
    sessionId,
    finalText: "done",
    writeFile: { path: `src/${phaseId}.ts`, content: `export const built = 1;\n` },
  };
  const fix: FakeScript = {
    sessionId,
    finalText: "fixed",
    writeFile: { path: `src/${phaseId}.ts`, content: `export const built = 2;\n` },
  };
  const handoff: FakeScript = {
    sessionId,
    finalText: "handoff written",
    writeFile: { path: ".phax-context/phase-handoff.md", content: HANDOFF(phaseId) },
  };
  return options.fix ? [work, fix, handoff] : [work, handoff];
}
