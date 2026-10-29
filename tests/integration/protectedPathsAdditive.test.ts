import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeNodeBackendLayer } from "../../src/infra/claudeCli.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  VIBE3_EXPORT_SHORT,
  VIBE3_SESSION_ID,
  vibe3Assistant,
  vibe3StreamText,
  vibe3Text,
  writeFakeVibe,
  vibe3ExportText,
} from "../helpers/vibe3Fixtures.js";

// The no-change guarantee of the protected-paths work (spec §5.5): a project
// that declares no `protectedPaths` sees exactly what it saw before. One phase
// per provider (secure mode), a gate that fails once and then passes, run end
// to end through executePlan with the real backend and the fake CLIs. The
// argv, the environment phax adds, the prompts, the gate attempt logs and what
// phax printed are pinned by the snapshot beside this file, written before any
// protectedPaths behaviour existed. No later phase may change that snapshot.
// security.json and gate-attribution.json are asserted explicitly instead:
// phase-04 changes exactly those expectations.

const NAMESPACE = "example";
const SHORT = "invoice-export";
const SESSION = "3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42";

const HANDOFF = [
  "## What was delivered",
  "- phase-01 delivered its file.",
  "## Key decisions and why",
  "- None.",
  "## Exact locations (file paths and exported names)",
  "- src/phase-01.ts",
  "## What the next phase needs to know",
  "- Ready to proceed.",
  "",
].join("\n");

const FILE_V1 = "export const phase01 = 1;\n";
const FILE_V2 = "export const phase01 = 2;\n";

// Fails its first run in a worktree and passes from then on; the marker lives
// in the gitignored .phax-context/, so the worktree stays clean.
const GATE_SCRIPT = [
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

// ── The world ──────────────────────────────────────────────────────────────

interface World {
  readonly root: string;
  readonly repoRoot: string;
  readonly stateRoot: string;
}

let world: World;
let cli: FakeProviderCli;
let restoreGit: () => void;

beforeEach(() => {
  restoreGit = isolateGit();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-protected-additive-test-")));
  const repoRoot = join(root, "repo");
  const stateRoot = join(root, "state");
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
  writeFileSync(join(repoRoot, "scripts", "gate.mjs"), GATE_SCRIPT);
  git("add", "-A");
  git("commit", "-m", "chore: start");
  world = { root, repoRoot, stateRoot };

  cli = makeFakeProviderCli(root);
  for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  restoreGit();
  removeTempDir(world.root);
});

// ── The plan and the configuration ─────────────────────────────────────────

function planOf(model: string, effort: "medium" | "high"): { plan: PhaxPlan; planMd: string } {
  const phase: PhaxPlanPhase = {
    id: "phase-01",
    title: "Export step",
    model,
    effort,
    planMarkdownAnchor: "#phase-01",
    plannedFilesToCreate: ["src/phase-01.ts"],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode: "headless",
    oracle: null,
    testLines: [],
    commit: { subject: "feat(export): step one", body: "Made-up body." },
  };
  const plan = {
    run: {
      shortName: SHORT,
      title: "Invoice export",
      branch: `phax/${SHORT}`,
      requiredCommands: [],
    },
    phases: [phase] as unknown as PhaxPlan["phases"],
  } satisfies PhaxPlan;
  const planMd = [
    "# Invoice export",
    "",
    "## Required commands",
    "",
    "- (none)",
    "",
    `## ${phase.id} — ${phase.title} {#${phase.id}}`,
    "",
    `**Recommended model:** ${model}`,
    `**Recommended effort:** ${effort}`,
    "",
    "### Detailed instructions",
    "",
    "Write src/phase-01.ts.",
    "",
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
          {
            command: "node scripts/gate.mjs",
            surface: "local",
            firing: "every-phase",
            output: "log",
          },
        ],
      },
    },
    stateRoot: world.stateRoot,
    namespace: NAMESPACE,
    repoRoot: world.repoRoot,
    maxFixAttempts: 2,
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

type ProviderName = "claude-code" | "codex-cli" | "mistral-vibe";

// Only the provider under test is enabled, so routing has one place to send
// the phase.
function providerConfigOf(provider: ProviderName, vibePath: string): ProviderConfig {
  const base = DEFAULT_PROVIDER_CONFIG.providers;
  return {
    providers: {
      "claude-code": { ...base["claude-code"]!, enabled: provider === "claude-code" },
      "codex-cli": {
        ...base["codex-cli"]!,
        enabled: provider === "codex-cli",
        executable: cli.codexPath,
      },
      "mistral-vibe": {
        ...base["mistral-vibe"]!,
        enabled: provider === "mistral-vibe",
        executable: vibePath,
      },
    },
  } as ProviderConfig;
}

// ── Running a phase ────────────────────────────────────────────────────────

interface Observed {
  readonly argv: readonly (readonly string[])[];
  readonly addedEnv: readonly Readonly<Record<string, string>>[];
  readonly prompts: readonly string[];
  readonly gateLogs: Readonly<Record<string, string>>;
  readonly output: readonly string[];
  readonly phaseFolder: string;
  readonly result: Either.Either<unknown, unknown>;
}

// The variables a child has that the test process did not hand it: what phax
// itself set for the spawn.
function addedTo(
  baseline: Readonly<Record<string, string | undefined>>,
  env: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([name, value]) => baseline[name] !== value)
      .toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

async function runPhase(provider: ProviderName): Promise<Observed> {
  const vibeDir = join(world.root, "vibe-bin");
  const vibe = writeFakeVibe(vibeDir, {
    stream: vibe3StreamText([vibe3Assistant([vibe3Text("done")])]),
    exportText: vibe3ExportText(VIBE3_EXPORT_SHORT),
    turnWrites: [
      [{ path: "src/phase-01.ts", content: FILE_V1 }],
      [{ path: "src/phase-01.ts", content: FILE_V2 }],
      [{ path: ".phax-context/phase-handoff.md", content: HANDOFF }],
    ],
  });
  cli.setScripts([
    {
      sessionId: SESSION,
      finalText: "done",
      writeFile: { path: "src/phase-01.ts", content: FILE_V1 },
    },
    {
      sessionId: SESSION,
      finalText: "fixed",
      writeFile: { path: "src/phase-01.ts", content: FILE_V2 },
    },
    {
      sessionId: SESSION,
      finalText: "handoff written",
      writeFile: { path: ".phax-context/phase-handoff.md", content: HANDOFF },
    },
  ]);

  const [model, effort] =
    provider === "mistral-vibe"
      ? (["claude-sonnet-4-6", "high"] as const)
      : (["claude-sonnet-5-5", "medium"] as const);
  const { plan, planMd } = planOf(model, effort);
  const shortName = Either.getOrThrow(decodeShortName(SHORT));
  const config = configOf();
  const { runPath, runId } = await Effect.runPromise(
    createRunFolder(shortName, planMd, plan, config).pipe(Effect.provide(NodeFileSystemLayer)),
  );

  const baseline = { ...process.env };
  const output: string[] = [];
  const capture = (chunk: unknown): boolean => {
    output.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capture);
  vi.spyOn(process.stderr, "write").mockImplementation(capture);

  const providerConfig = providerConfigOf(provider, vibe.executable);
  const result = await Effect.runPromise(
    Effect.either(
      executePlan({
        phaxVersion: "0.0.0-test",
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
        routing: { ...DEFAULT_MODEL_ROUTING, providerPriority: [provider] },
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
  vi.restoreAllMocks();

  const phaseFolder = join(runPath, "phase-01");
  const gateLogs = Object.fromEntries(
    readdirSync(phaseFolder)
      .filter((name) => name.startsWith("checks-attempt-") && name.endsWith(".log"))
      .toSorted()
      .map((name) => [name, readFileSync(join(phaseFolder, name), "utf8")]),
  );

  if (provider === "mistral-vibe") {
    const turns = vibe.traces();
    return {
      argv: turns.map((turn) => {
        // The prompt rides in argv after -p; it is recorded under `prompts`.
        const at = turn.argv.indexOf("-p");
        return turn.argv.map((arg, i) => (i === at + 1 ? "<prompt>" : arg));
      }),
      addedEnv: turns.map((turn) => addedTo(baseline, turn.env)),
      prompts: turns.map((turn) => turn.argv[turn.argv.indexOf("-p") + 1] ?? ""),
      gateLogs,
      output,
      phaseFolder,
      result,
    };
  }
  return {
    argv: cli.invocations().map((call) => call.argv),
    addedEnv: cli.traces().map((trace) => addedTo(baseline, trace.env)),
    prompts: cli.traces().map((trace) => trace.stdin),
    gateLogs,
    output,
    phaseFolder,
    result,
  };
}

// ── Normalizing ────────────────────────────────────────────────────────────

// Temporary paths, session ids, instants and commit hashes become placeholders.
function normalize(text: string): string {
  return text
    .replaceAll(world.root, "<ROOT>")
    .replaceAll(SESSION, "<SESSION>")
    .replaceAll(VIBE3_SESSION_ID, "<SESSION>")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<INSTANT>")
    .replace(/\b[0-9a-f]{40}\b/g, "<COMMIT>")
    .replace(/\b\d{13}\b/g, "<EPOCH-MS>");
}

const normalized = <T>(value: T): T => JSON.parse(normalize(JSON.stringify(value))) as T;

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

// ── The phases ─────────────────────────────────────────────────────────────

describe.each<ProviderName>(["claude-code", "codex-cli", "mistral-vibe"])(
  "a phase on %s in a project that declares no protectedPaths",
  (provider) => {
    it(
      "keeps its argv, environment, prompts, gate logs and output",
      { timeout: 60_000 },
      async () => {
        const observed = await runPhase(provider);
        if (Either.isLeft(observed.result)) throw observed.result.left as Error;

        // Work turn, fix turn after the red attempt, handoff turn.
        expect(observed.argv).toHaveLength(3);
        expect(observed.prompts).toHaveLength(3);
        expect(Object.keys(observed.gateLogs).length).toBeGreaterThanOrEqual(2);

        expect(normalized(observed.argv)).toMatchSnapshot("argv");
        expect(normalized(observed.addedEnv)).toMatchSnapshot("environment phax adds");
        expect(observed.prompts.map(normalize)).toMatchSnapshot("prompts");
        expect(normalized(observed.gateLogs)).toMatchSnapshot("gate attempt logs");
        expect(observed.output.map(normalize)).toMatchSnapshot("output");
      },
    );

    it(
      "records security.json and gate-attribution.json as before",
      { timeout: 60_000 },
      async () => {
        const observed = await runPhase(provider);
        if (Either.isLeft(observed.result)) throw observed.result.left as Error;

        // Today's values, spelled out: phase-04 changes exactly these (security.json
        // version 3 and gate-attribution.json 0.31.0, each with `protectedPaths: null`).
        const worktree = join(world.stateRoot, "worktrees", `${NAMESPACE}.${SHORT}`, "phase-01");
        const commandPrecision = provider === "codex-cli";
        expect(readJson(join(observed.phaseFolder, "security.json"))).toEqual({
          version: 2,
          mode: "secure",
          provider,
          sandboxEnabled: true,
          filesystem: { allowRead: [worktree], allowWrite: [worktree] },
          network: { profile: "provider-only" },
          mcp: { mode: "disabled", allow: [] },
          downgraded: false,
          marks: commandPrecision ? ["command-precision"] : [],
          agentCommands: [
            {
              command: "node scripts/gate.mjs",
              source: "gate",
              explicit: false,
              requiredByPlan: false,
              enforcement: commandPrecision ? "none" : "prefix",
              degraded: commandPrecision,
            },
          ],
          skillEditGrants: [],
          providerSkippedForSecurity: [],
          stop: null,
        });
        expect(readJson(join(observed.phaseFolder, "gate-attribution.json"))).toEqual({
          $schema: "https://docs.phax.run/schemas/gate-attribution/0.26.0.json",
          phase: "phase-01",
          steps: [{ command: "node scripts/gate.mjs", surface: "local", result: "pass" }],
        });
      },
    );
  },
);
