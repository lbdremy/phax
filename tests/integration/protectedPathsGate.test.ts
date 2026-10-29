import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import { decodeShortName } from "../../src/domain/branded.js";
import { GateAttemptsExhaustedError, GateStepRefusedError } from "../../src/domain/errors.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { protectedList } from "../../src/domain/security/protectedPaths.js";
import { makeNodeBackendLayer } from "../../src/infra/claudeCli.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { Git } from "../../src/ports/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type GateStep,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// The protected-paths check at the gate (spec §5.12 to §5.16, §6): in a project
// that declares `protectedPaths`, every gate attempt checks the phase's files
// against its base after the steps, and a protected change fails the attempt
// whatever the steps' exit codes. One phase per case, run end to end through
// executePlan with the real backend, the real git adapter and the fake CLIs.

const NAMESPACE = "example";
const SHORT = "invoice-export";
const SESSION = "3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42";
const BASELINE_A = "packages/a/steme.baseline.json";
const BASELINE_RUST = "packages/rust/steme-formats/steme.baseline.json";
const SNAPSHOT = "snapshots/api.snap";
const ORIGINAL = "{}\n";
const EDITED = '{"debt":["x"]}\n';
const PHAX_JSON = '{"name":"example","protectedPaths":["**/steme.baseline.json"]}\n';

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

// A gate step that writes a protected file and exits 0, every time it runs.
const ACCEPT_DEBT = [
  'const fs = require("node:fs");',
  `fs.writeFileSync("${BASELINE_A}", ${JSON.stringify(EDITED)});`,
  "",
].join("\n");

// A gate step that writes a protected file on its first run in a worktree and
// puts it back on every later one, so a fix turn lets the phase pass.
const TOUCH_THEN_RESTORE = [
  'const fs = require("node:fs");',
  'const marker = ".phax-context/touched";',
  "if (fs.existsSync(marker)) {",
  `  fs.writeFileSync("${BASELINE_A}", ${JSON.stringify(ORIGINAL)});`,
  "} else {",
  '  fs.mkdirSync(".phax-context", { recursive: true });',
  '  fs.writeFileSync(marker, "");',
  `  fs.writeFileSync("${BASELINE_A}", ${JSON.stringify(EDITED)});`,
  "}",
  "",
].join("\n");

const AUDIT_FAILS = [
  'console.error("audit: the invoice header is missing");',
  "process.exitCode = 1;",
  "",
].join("\n");

const REASON = "the checks need hw-rules 2, and 1 is installed";
const REMEDY = "pnpm add -D hw-rules@2";
const REFUSE = [
  `console.log(${JSON.stringify(
    JSON.stringify({
      $schema: currentSchemaUrl("gate-report"),
      outcome: "refused",
      reason: REASON,
      remedy: REMEDY,
    }),
  )});`,
  "",
].join("\n");

const REPO_FILES: Readonly<Record<string, string>> = {
  ".gitignore": ".phax-context/\n",
  "src/keep.ts": "export const keep = 1;\n",
  "phax.json": PHAX_JSON,
  [BASELINE_A]: ORIGINAL,
  [BASELINE_RUST]: ORIGINAL,
  [SNAPSHOT]: "api v1\n",
  "scripts/pass.js": "\n",
  "scripts/accept-debt.js": ACCEPT_DEBT,
  "scripts/touch-then-restore.js": TOUCH_THEN_RESTORE,
  "scripts/audit-fails.js": AUDIT_FAILS,
  "scripts/refuse.js": REFUSE,
};

const step = (command: string, output: GateStep["output"] = "log"): GateStep => ({
  command,
  surface: "local",
  firing: "every-phase",
  output,
});

const PASS = step("node scripts/pass.js");

interface World {
  readonly root: string;
  readonly repoRoot: string;
  /** The state root as phax is given it: a symlink to `realStateRoot`. */
  readonly stateRoot: string;
  readonly realStateRoot: string;
}

let world: World;
let cli: FakeProviderCli;
let restoreGit: () => void;

beforeEach(() => {
  restoreGit = isolateGit();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-protected-gate-test-")));
  const repoRoot = join(root, "repo");
  const realStateRoot = join(root, "state");
  const stateRoot = join(root, "state-link");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(realStateRoot, { recursive: true });
  symlinkSync(realStateRoot, stateRoot);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
  git("init", "--initial-branch=main");
  disableGitAutoMaintenance(repoRoot);
  git("config", "--local", "user.email", "ada@example.test");
  git("config", "--local", "user.name", "Ada Example");
  for (const [path, content] of Object.entries(REPO_FILES)) {
    mkdirSync(dirname(join(repoRoot, path)), { recursive: true });
    writeFileSync(join(repoRoot, path), content);
  }
  git("add", "-A");
  git("commit", "-m", "chore: start");
  world = { root, repoRoot, stateRoot, realStateRoot };

  cli = makeFakeProviderCli(root);
  for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  restoreGit();
  removeTempDir(world.root);
});

function planOf(): { plan: PhaxPlan; planMd: string } {
  const phase: PhaxPlanPhase = {
    id: "phase-01",
    title: "Export step",
    model: "claude-sonnet-5-5",
    effort: "medium",
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
    "**Recommended model:** claude-sonnet-5-5",
    "**Recommended effort:** medium",
    "",
    "### Detailed instructions",
    "",
    "Write src/phase-01.ts.",
    "",
  ].join("\n");
  return { plan, planMd };
}

function configOf(input: {
  readonly globs: readonly string[] | null;
  readonly profile: "secure" | "unsafe";
  readonly steps: readonly [GateStep, ...GateStep[]];
  readonly maxFixAttempts: number;
  readonly agentCommands: readonly string[];
}): ResolvedConfig {
  const declared = input.globs === null ? null : protectedList(input.globs, "phax.json");
  return {
    ...(declared === null ? {} : { protectedPaths: declared }),
    raw: {
      version: 1,
      name: NAMESPACE,
      state: { root: world.stateRoot },
      gateProfiles: { standard: input.steps },
    },
    stateRoot: world.stateRoot,
    namespace: NAMESPACE,
    repoRoot: world.repoRoot,
    maxFixAttempts: input.maxFixAttempts,
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
      profile: input.profile,
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: input.agentCommands,
    },
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
  } as ResolvedConfig;
}

type ProviderName = "claude-code" | "codex-cli";

function providerConfigOf(provider: ProviderName): ProviderConfig {
  const base = DEFAULT_PROVIDER_CONFIG.providers;
  return {
    providers: {
      "claude-code": { ...base["claude-code"]!, enabled: provider === "claude-code" },
      "codex-cli": {
        ...base["codex-cli"]!,
        enabled: provider === "codex-cli",
        executable: cli.codexPath,
      },
      "mistral-vibe": { ...base["mistral-vibe"]!, enabled: false },
    },
  } as ProviderConfig;
}

/** One scripted turn of the fake CLI: the file it writes, if any. */
interface Turn {
  readonly file?: { readonly path: string; readonly content: string };
}

interface PhaseCase {
  readonly provider: ProviderName;
  readonly profile?: "secure" | "unsafe";
  /** The declared globs, or null for a project that declares none. */
  readonly globs: readonly string[] | null;
  readonly steps: readonly [GateStep, ...GateStep[]];
  /** The agent's turns, in order; the last one repeats for any turn past the end. */
  readonly turns: readonly Turn[];
  readonly maxFixAttempts?: number;
  readonly agentCommands?: readonly string[];
  readonly git?: Layer.Layer<Git>;
}

interface Observed {
  readonly result: Either.Either<unknown, unknown>;
  readonly runPath: string;
  readonly phaseFolder: string;
  readonly worktree: string;
  readonly prompts: readonly string[];
  readonly argv: readonly (readonly string[])[];
}

async function runPhase(input: PhaseCase): Promise<Observed> {
  cli.setScripts(
    input.turns.map((turn, index) => ({
      sessionId: SESSION,
      finalText: index === 0 ? "done" : "fixed",
      ...(turn.file === undefined ? {} : { writeFile: turn.file }),
    })),
  );
  const { plan, planMd } = planOf();
  const shortName = Either.getOrThrow(decodeShortName(SHORT));
  const config = configOf({
    globs: input.globs,
    profile: input.profile ?? "secure",
    steps: input.steps,
    maxFixAttempts: input.maxFixAttempts ?? 1,
    agentCommands: input.agentCommands ?? [],
  });
  const { runPath, runId } = await Effect.runPromise(
    createRunFolder(shortName, planMd, plan, config, undefined, true).pipe(
      Effect.provide(NodeFileSystemLayer),
    ),
  );
  const providerConfig = providerConfigOf(input.provider);
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
        allowSkillEdits: false,
        runPath,
        runId,
        startIndex: 0,
        routing: { ...DEFAULT_MODEL_ROUTING, providerPriority: [input.provider] },
        providerConfig,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeNodeBackendLayer(providerConfig),
            NodeFileSystemLayer,
            input.git ?? NodeGitLayer,
            NodeShellLayer,
            NoopSystemTelemetryLayer,
            makeFakeGitHub().layer,
          ),
        ),
      ),
    ),
  );
  return {
    result,
    runPath,
    phaseFolder: join(runPath, "phase-01"),
    worktree: join(world.realStateRoot, "worktrees", `${NAMESPACE}.${SHORT}`, "phase-01"),
    prompts: cli.traces().map((trace) => trace.stdin),
    argv: cli.invocations().map((call) => call.argv),
  };
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function exhaustedOf(observed: Observed): GateAttemptsExhaustedError {
  if (Either.isRight(observed.result)) throw new Error("the phase was expected to pause");
  expect(observed.result.left).toBeInstanceOf(GateAttemptsExhaustedError);
  return observed.result.left as GateAttemptsExhaustedError;
}

function commitSubjects(worktree: string): string[] {
  return execFileSync("git", ["log", "--format=%s"], { cwd: worktree, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);
}

const GLOB = "**/steme.baseline.json";
const EDIT_RUST: Turn = { file: { path: BASELINE_RUST, content: EDITED } };

describe("a protected edit by the agent's own tools", () => {
  it(
    "fails an attempt whose steps all passed, resumes the session with the fix prompt and commits nothing",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase({
        provider: "codex-cli",
        globs: [GLOB],
        steps: [PASS],
        turns: [EDIT_RUST],
      });

      const error = exhaustedOf(observed);
      expect(error.failure).toEqual({
        failedStep: "protected-paths",
        protectedChanges: [
          { path: BASELINE_RUST, kind: "edited", entry: "protectedPaths[0]", glob: GLOB },
        ],
      });
      // The phase turn, then the fix turn: a resume of the same session.
      expect(observed.prompts).toHaveLength(2);
      expect(observed.argv[1]).toContain("resume");
      const fixPrompt = observed.prompts[1] ?? "";
      expect(fixPrompt).toContain("**Failed step:** protected paths");
      expect(fixPrompt).toContain(`- ${BASELINE_RUST} — edited (protectedPaths[0] ${GLOB})`);
      expect(fixPrompt).toContain("are the operator's decision");
      expect(commitSubjects(observed.worktree)).toEqual(["chore: start"]);
    },
  );

  it(
    "lets the phase pass once the file is put back, and records the pass",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase({
        provider: "codex-cli",
        globs: [GLOB],
        steps: [step("node scripts/touch-then-restore.js")],
        turns: [
          { file: { path: "src/phase-01.ts", content: "export const phase01 = 1;\n" } },
          { file: { path: "src/phase-01.ts", content: "export const phase01 = 2;\n" } },
          { file: { path: ".phax-context/phase-handoff.md", content: HANDOFF } },
        ],
      });

      if (Either.isLeft(observed.result)) throw observed.result.left as Error;
      expect(commitSubjects(observed.worktree)).toEqual(["feat(export): step one", "chore: start"]);
      // The first attempt failed for the check alone, with its own record.
      expect(
        readJson(join(observed.phaseFolder, "checks-attempt-01.attribution.json")),
      ).toMatchObject({
        protectedPaths: {
          result: "fail",
          changes: [{ path: BASELINE_A, kind: "edited", entry: "protectedPaths[0]" }],
        },
      });
      expect(
        readJson(join(observed.phaseFolder, "checks-attempt-02.attribution.json")),
      ).toMatchObject({
        protectedPaths: { result: "pass", changes: [] },
      });
      expect(readJson(join(observed.phaseFolder, "gate-attribution.json"))).toMatchObject({
        protectedPaths: { result: "pass", changes: [] },
      });
    },
  );
});

describe("a protected write by a gate step", () => {
  it(
    "fails the attempt naming the path although the step exits 0",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase({
        provider: "codex-cli",
        globs: [GLOB],
        steps: [step("node scripts/accept-debt.js")],
        turns: [{ file: { path: "src/phase-01.ts", content: "export const phase01 = 1;\n" } }],
      });

      const error = exhaustedOf(observed);
      expect(error.failure).toMatchObject({
        failedStep: "protected-paths",
        protectedChanges: [{ path: BASELINE_A, kind: "edited", entry: "protectedPaths[0]" }],
      });
      expect(error.message).toContain(BASELINE_A);
      expect(commitSubjects(observed.worktree)).toEqual(["chore: start"]);
    },
  );
});

describe("a protected snapshot rewritten by an allowlisted command", () => {
  it(
    "fails the attempt naming it on claude-code secure, which only denies the agent's own edits",
    { timeout: 60_000 },
    async () => {
      // The fake CLI stands in for `pnpm snapshot:update`: the command's effect
      // is a rewritten snapshot, which no Edit deny rule sees.
      const observed = await runPhase({
        provider: "claude-code",
        globs: [SNAPSHOT],
        steps: [PASS],
        agentCommands: ["pnpm snapshot:update"],
        turns: [{ file: { path: SNAPSHOT, content: "api v2\n" } }],
      });

      const error = exhaustedOf(observed);
      expect(error.failure).toMatchObject({
        failedStep: "protected-paths",
        protectedChanges: [{ path: SNAPSHOT, kind: "edited", entry: "protectedPaths[0]" }],
      });
      expect(readJson(join(observed.phaseFolder, "security.json"))).toMatchObject({
        protectedPaths: { globs: [SNAPSHOT, "phax.json"], enforcement: "enforced" },
      });
    },
  );
});

describe("the phax.json the run was loaded from", () => {
  it(
    "fails the attempt naming phax.json when the agent removes the key",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase({
        provider: "codex-cli",
        globs: [GLOB],
        steps: [PASS],
        turns: [{ file: { path: "phax.json", content: '{"name":"example"}\n' } }],
      });

      const error = exhaustedOf(observed);
      expect(error.failure).toEqual({
        failedStep: "protected-paths",
        protectedChanges: [
          { path: "phax.json", kind: "edited", entry: "phax.json", glob: "phax.json" },
        ],
      });
      expect(observed.prompts[1]).toContain("- phax.json — edited (phax.json)");
    },
  );
});

describe("a step failure or refusal together with a protected edit", () => {
  it(
    "gives the fix prompt both the failed step and the protected path",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase({
        provider: "codex-cli",
        globs: [GLOB],
        steps: [step("node scripts/audit-fails.js")],
        turns: [EDIT_RUST],
      });

      const error = exhaustedOf(observed);
      expect(error.failure).toMatchObject({
        failedStep: "configured",
        command: "node scripts/audit-fails.js",
        exitCode: 1,
        protectedChanges: [{ path: BASELINE_RUST, kind: "edited" }],
      });
      const fixPrompt = observed.prompts[1] ?? "";
      expect(fixPrompt).toContain("**Failed command:** `node scripts/audit-fails.js`");
      expect(fixPrompt).toContain("audit: the invoice header is missing");
      expect(fixPrompt).toContain("## Protected paths changed");
      expect(fixPrompt).toContain(`- ${BASELINE_RUST} — edited`);
    },
  );

  it(
    "pauses a refused step with no fix attempt, naming the step and the path",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase({
        provider: "codex-cli",
        globs: [GLOB],
        steps: [step("node scripts/refuse.js", "gate-report")],
        turns: [EDIT_RUST],
      });

      if (Either.isRight(observed.result)) throw new Error("the phase was expected to pause");
      const error = observed.result.left;
      expect(error).toBeInstanceOf(GateStepRefusedError);
      expect(error).toMatchObject({
        command: "node scripts/refuse.js",
        reason: REASON,
        protectedChanges: [{ path: BASELINE_RUST, kind: "edited", entry: "protectedPaths[0]" }],
      });
      expect(exitCodeForError(error)).toBe(4);
      // The phase turn only: no fix attempt.
      expect(observed.prompts).toHaveLength(1);
      const instructions = readFileSync(join(observed.runPath, "resume-instructions.md"), "utf8");
      expect(instructions).toContain("the gate step `node scripts/refuse.js` refused to run");
      expect(instructions).toContain(REASON);
      expect(instructions).toContain(`- ${BASELINE_RUST} — edited (protectedPaths[0] ${GLOB})`);
      expect(instructions).not.toContain("reset-phase");
    },
  );
});

describe("a protected file the agent leaves changed at every attempt", () => {
  it(
    "pauses the phase in gates_exhausted with exit 4, naming the path, the last fix transcript and the two ways on",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase({
        provider: "codex-cli",
        globs: [GLOB],
        steps: [PASS],
        maxFixAttempts: 2,
        turns: [EDIT_RUST],
      });

      const error = exhaustedOf(observed);
      expect(exitCodeForError(error)).toBe(4);
      expect(error.attempt).toBe(3);
      // Three agent turns: the phase turn and two fix attempts.
      expect(observed.prompts).toHaveLength(3);
      expect(error.lastFixTranscript).toBe(join(observed.phaseFolder, "fix-attempt-02.jsonl"));

      expect(readJson(join(observed.phaseFolder, "status.json"))).toMatchObject({
        state: "gates_exhausted",
      });
      expect(readJson(join(observed.runPath, "run-status.json"))).toMatchObject({
        stoppedReason: "gates_exhausted",
        lastError: `Gate failed: protected paths changed (${BASELINE_RUST})`,
      });

      const instructions = readFileSync(join(observed.runPath, "resume-instructions.md"), "utf8");
      expect(instructions).toContain(`- ${BASELINE_RUST} — edited (protectedPaths[0] ${GLOB})`);
      expect(instructions).toContain("No phase of this run may change these paths");
      expect(instructions).toContain("fix-attempt-02.jsonl");
      expect(instructions).toContain("phax resume invoice-export --yes");
      expect(instructions).toContain("make it on the base branch yourself and start a new run");
      expect(instructions).not.toContain("reset-phase");
    },
  );
});

describe("a secure codex-cli phase and an unsafe claude-code phase", () => {
  it.each([
    ["codex-cli", "secure"],
    ["claude-code", "unsafe"],
  ] as const)(
    "each fail a protected write at the gate (%s, %s)",
    { timeout: 60_000 },
    async (provider, profile) => {
      const observed = await runPhase({
        provider,
        profile,
        globs: [GLOB],
        steps: [PASS],
        turns: [EDIT_RUST],
      });

      const error = exhaustedOf(observed);
      expect(error.failure).toMatchObject({
        failedStep: "protected-paths",
        protectedChanges: [{ path: BASELINE_RUST, kind: "edited", entry: "protectedPaths[0]" }],
      });
      expect(commitSubjects(observed.worktree)).toEqual(["chore: start"]);
    },
  );
});

describe("the gate-attribution record of a failed check", () => {
  it(
    "carries the 0.31.0 $schema and the fail result with path, kind and entry",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase({
        provider: "codex-cli",
        globs: [GLOB],
        steps: [step("node scripts/accept-debt.js")],
        turns: [{ file: { path: "src/phase-01.ts", content: "export const phase01 = 1;\n" } }],
      });
      exhaustedOf(observed);

      const attribution = readJson(join(observed.phaseFolder, "gate-attribution.json")) as {
        $schema: string;
      };
      expect(attribution.$schema).toBe(currentSchemaUrl("gate-attribution"));
      expect(attribution.$schema).toContain("0.31.0");
      expect(attribution).toMatchObject({
        phase: "phase-01",
        steps: [{ command: "node scripts/accept-debt.js", surface: "local", result: "pass" }],
        protectedPaths: {
          result: "fail",
          changes: [{ path: BASELINE_A, kind: "edited", entry: "protectedPaths[0]" }],
        },
      });
      // The phase's record is the last attempt's step record, the same document.
      expect(readJson(join(observed.phaseFolder, "checks-attempt-02.attribution.json"))).toEqual(
        attribution,
      );
    },
  );
});

describe("a project that declares no protectedPaths", () => {
  it("makes no worktree observation and records a null check", { timeout: 60_000 }, async () => {
    const realGit = Effect.runSync(Effect.provide(Git, NodeGitLayer));
    let observations = 0;
    const spy = Layer.succeed(Git, {
      ...realGit,
      observeWorktree: (...args: Parameters<typeof realGit.observeWorktree>) => {
        observations += 1;
        return realGit.observeWorktree(...args);
      },
    });

    const observed = await runPhase({
      provider: "codex-cli",
      globs: null,
      steps: [step("node scripts/accept-debt.js")],
      turns: [
        { file: { path: "src/phase-01.ts", content: "export const phase01 = 1;\n" } },
        { file: { path: ".phax-context/phase-handoff.md", content: HANDOFF } },
      ],
      git: spy,
    });

    // The step rewrote a baseline, but nothing is protected here: the phase commits.
    if (Either.isLeft(observed.result)) throw observed.result.left as Error;
    expect(observations).toBe(0);
    expect(existsSync(join(observed.phaseFolder, "gate-attribution.json"))).toBe(true);
    expect(readJson(join(observed.phaseFolder, "gate-attribution.json"))).toMatchObject({
      protectedPaths: null,
    });
    expect(commitSubjects(observed.worktree)).toEqual(["feat(export): step one", "chore: start"]);
  });
});
