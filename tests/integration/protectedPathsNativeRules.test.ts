import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
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
import { protectedList } from "../../src/domain/security/protectedPaths.js";
import { makeNodeBackendLayer } from "../../src/infra/claudeCli.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
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
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  VIBE3_EXPORT_SHORT,
  vibe3Assistant,
  vibe3ExportText,
  vibe3StreamText,
  vibe3Text,
  writeFakeVibe,
} from "../helpers/vibe3Fixtures.js";

// The native protected-path rules (spec §5.9 to §5.11): in secure mode, Claude
// Code's phase turn, fix attempt and handoff turn each carry one --settings
// with the skill-edit hooks and the Edit deny rules; Vibe's VIBE_TOOLS
// denylists hold the protected entries under the worktree's resolved path;
// Codex and unsafe mode carry none. One phase per case, run end to end through
// executePlan with the real backend and the fake CLIs.

const NAMESPACE = "example";
const SHORT = "invoice-export";
const SESSION = "3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42";
const SKILL_FILE = ".claude/skills/release/SKILL.md";

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

// Fails its first run in a worktree and passes from then on, so the phase has a
// work turn, a fix turn and a handoff turn.
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phax-protected-native-test-")));
  const repoRoot = join(root, "repo");
  const realStateRoot = join(root, "state");
  const stateRoot = join(root, "state-link");
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  mkdirSync(join(repoRoot, "scripts"), { recursive: true });
  mkdirSync(realStateRoot, { recursive: true });
  symlinkSync(realStateRoot, stateRoot);
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

function planOf(model: string, effort: "medium" | "high"): { plan: PhaxPlan; planMd: string } {
  const phase: PhaxPlanPhase = {
    id: "phase-01",
    title: "Export step",
    model,
    effort,
    planMarkdownAnchor: "#phase-01",
    plannedFilesToCreate: ["src/phase-01.ts"],
    plannedFilesToEdit: [SKILL_FILE],
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

function configOf(globs: readonly string[], profile: "secure" | "unsafe"): ResolvedConfig {
  const declared = protectedList(globs, "phax.json");
  return {
    ...(declared === null ? {} : { protectedPaths: declared }),
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
      profile,
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

interface Observed {
  /** Each turn's argv, the prompt of a Vibe turn replaced by a placeholder. */
  readonly argv: readonly (readonly string[])[];
  readonly vibeEnv: readonly Readonly<Record<string, string>>[];
  readonly prompts: readonly string[];
  readonly phaseFolder: string;
  readonly worktree: string;
  readonly realWorktree: string;
}

async function runPhase(
  provider: ProviderName,
  globs: readonly string[],
  profile: "secure" | "unsafe" = "secure",
): Promise<Observed> {
  const vibe = writeFakeVibe(join(world.root, "vibe-bin"), {
    stream: vibe3StreamText([vibe3Assistant([vibe3Text("done")])]),
    exportText: vibe3ExportText(VIBE3_EXPORT_SHORT),
    turnWrites: [
      [{ path: "src/phase-01.ts", content: "export const phase01 = 1;\n" }],
      [{ path: "src/phase-01.ts", content: "export const phase01 = 2;\n" }],
      [{ path: ".phax-context/phase-handoff.md", content: HANDOFF }],
    ],
  });
  cli.setScripts([
    {
      sessionId: SESSION,
      finalText: "done",
      writeFile: { path: "src/phase-01.ts", content: "export const phase01 = 1;\n" },
    },
    {
      sessionId: SESSION,
      finalText: "fixed",
      writeFile: { path: "src/phase-01.ts", content: "export const phase01 = 2;\n" },
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
  const config = configOf(globs, profile);
  const { runPath, runId } = await Effect.runPromise(
    createRunFolder(shortName, planMd, plan, config, undefined, true).pipe(
      Effect.provide(NodeFileSystemLayer),
    ),
  );

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
        allowSkillEdits: true,
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
  if (Either.isLeft(result)) throw result.left as Error;

  const worktree = join(world.stateRoot, "worktrees", `${NAMESPACE}.${SHORT}`, "phase-01");
  const realWorktree = join(world.realStateRoot, "worktrees", `${NAMESPACE}.${SHORT}`, "phase-01");
  const phaseFolder = join(runPath, "phase-01");
  if (provider === "mistral-vibe") {
    const turns = vibe.traces();
    return {
      argv: turns.map((turn) => {
        const at = turn.argv.indexOf("-p");
        return turn.argv.map((arg, i) => (i === at + 1 ? "<prompt>" : arg));
      }),
      vibeEnv: turns.map((turn) => turn.env),
      prompts: turns.map((turn) => turn.argv[turn.argv.indexOf("-p") + 1] ?? ""),
      phaseFolder,
      worktree,
      realWorktree,
    };
  }
  return {
    argv: cli.invocations().map((call) => call.argv),
    vibeEnv: [],
    prompts: cli.traces().map((trace) => trace.stdin),
    phaseFolder,
    worktree,
    realWorktree,
  };
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const GLOBS = ["**/steme.baseline.json", "config/*.json", "locks/[a].json"] as const;

describe("a claude-code secure phase that declares protectedPaths", () => {
  it(
    "carries one --settings with the hooks and the two native deny rules in every turn",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase("claude-code", GLOBS);

      // The work turn, the fix turn after the red attempt, the handoff turn.
      expect(observed.argv).toHaveLength(3);
      const wt = observed.realWorktree;
      for (const argv of observed.argv) {
        expect(argv.filter((arg) => arg === "--settings")).toHaveLength(1);
        const settings = JSON.parse(argv[argv.indexOf("--settings") + 1] ?? "null") as {
          hooks: { PermissionRequest: { hooks: { if: string }[] }[] };
          permissions: { deny: string[] };
        };
        // Exactly the two native rules: the wildcard and bracket globs have none.
        expect(settings.permissions.deny).toEqual([
          `Edit(/${wt}/**/steme.baseline.json)`,
          `Edit(/${wt}/phax.json)`,
        ]);
        expect(Object.keys(settings).toSorted()).toEqual(["hooks", "permissions"]);
        expect(settings.hooks.PermissionRequest[0]?.hooks.map((hook) => hook.if)).toEqual([
          `Edit(/${wt}/${SKILL_FILE})`,
          `Write(/${wt}/${SKILL_FILE})`,
          `MultiEdit(/${wt}/${SKILL_FILE})`,
        ]);
      }

      const posture = readJson(join(observed.phaseFolder, "security.json")) as {
        skillEditGrants: string[];
        protectedPaths: unknown;
      };
      expect(posture.skillEditGrants).toEqual([SKILL_FILE]);
      expect(posture.protectedPaths).toEqual({
        globs: [...GLOBS, "phax.json"],
        enforcement: "partial",
      });
    },
  );

  it(
    "tells the agent which files are the operator's, in the phase prompt",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase("claude-code", GLOBS);
      const prompt = observed.prompts[0] ?? "";
      expect(prompt).toContain(
        ["## Protected paths", "", "These files are the operator's decision."].join("\n"),
      );
      expect(prompt).toContain(
        ["- **/steme.baseline.json", "- config/*.json", "- locks/[a].json", "- phax.json"].join(
          "\n",
        ),
      );
    },
  );

  it("records enforced when every glob has a native form", { timeout: 60_000 }, async () => {
    const observed = await runPhase("claude-code", ["**/steme.baseline.json"]);
    const argv = observed.argv[0] ?? [];
    const settings = JSON.parse(argv[argv.indexOf("--settings") + 1] ?? "null") as {
      permissions: { deny: string[] };
    };
    expect(settings.permissions.deny).toEqual([
      `Edit(/${observed.realWorktree}/**/steme.baseline.json)`,
      `Edit(/${observed.realWorktree}/phax.json)`,
    ]);
    const posture = readJson(join(observed.phaseFolder, "security.json")) as {
      protectedPaths: unknown;
    };
    expect(posture.protectedPaths).toEqual({
      globs: ["**/steme.baseline.json", "phax.json"],
      enforcement: "enforced",
    });
  });
});

describe("a mistral-vibe secure phase that declares protectedPaths", () => {
  it(
    "denies the protected entries under the worktree's realpath, and the read-back accepts them",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase("mistral-vibe", ["**/steme.baseline.json", "config/*.json"]);

      // The fixture reaches the worktree through a symlink: the entries use the real path.
      expect(observed.worktree).not.toBe(observed.realWorktree);
      expect(observed.argv).toHaveLength(3);
      const entries = [
        `${observed.realWorktree}/steme.baseline.json`,
        `${observed.realWorktree}/**/steme.baseline.json`,
        `${observed.realWorktree}/phax.json`,
      ];
      for (const [turn, argv] of observed.argv.entries()) {
        // --workdir and the guards stay as given.
        expect(argv[argv.indexOf("--workdir") + 1]).toBe(observed.worktree);
        const tools = JSON.parse(observed.vibeEnv[turn]?.["VIBE_TOOLS"] ?? "null") as Record<
          string,
          { denylist?: string[] }
        >;
        const guards = [".vibe", ".agents"].map((dir) => `${observed.worktree}/${dir}/**`);
        for (const tool of ["write_file", "edit"]) {
          expect(tools[tool]?.denylist?.slice(0, guards.length)).toEqual(guards);
          expect(tools[tool]?.denylist?.slice(guards.length)).toEqual(entries);
        }
        expect(tools["bash"]).not.toHaveProperty("denylist");
        // No entry for the wildcard glob.
        expect(JSON.stringify(tools)).not.toContain("config/");
      }
      // The post-turn read-back compares each export's config with the entries
      // built from the same resolved root: it accepted all three turns, or the
      // phase would have failed above (the fake resolves its export's config
      // from the turn's VIBE_TOOLS).

      const posture = readJson(join(observed.phaseFolder, "security.json")) as {
        protectedPaths: unknown;
      };
      expect(posture.protectedPaths).toEqual({
        globs: ["**/steme.baseline.json", "config/*.json", "phax.json"],
        enforcement: "partial",
      });
    },
  );
});

describe("a phase with no native protected-path rule", () => {
  it("codex-cli gets none and records commit-check-only", { timeout: 60_000 }, async () => {
    const observed = await runPhase("codex-cli", GLOBS);

    expect(observed.argv).toHaveLength(3);
    for (const argv of observed.argv) {
      expect(argv).not.toContain("--settings");
      expect(argv.some((arg) => arg.includes("Edit(") || arg.includes("steme.baseline"))).toBe(
        false,
      );
    }
    const posture = readJson(join(observed.phaseFolder, "security.json")) as {
      protectedPaths: unknown;
    };
    expect(posture.protectedPaths).toEqual({
      globs: [...GLOBS, "phax.json"],
      enforcement: "commit-check-only",
    });
  });

  it(
    "claude-code --security unsafe gets none and records commit-check-only",
    { timeout: 60_000 },
    async () => {
      const observed = await runPhase("claude-code", GLOBS, "unsafe");

      expect(observed.argv).toHaveLength(3);
      for (const argv of observed.argv) {
        expect(argv).toContain("bypassPermissions");
        expect(argv).not.toContain("--settings");
        expect(argv.some((arg) => arg.includes("Edit(") || arg.includes("steme.baseline"))).toBe(
          false,
        );
      }
      const posture = readJson(join(observed.phaseFolder, "security.json")) as {
        protectedPaths: unknown;
      };
      expect(posture.protectedPaths).toEqual({
        globs: [...GLOBS, "phax.json"],
        enforcement: "commit-check-only",
      });
    },
  );
});
