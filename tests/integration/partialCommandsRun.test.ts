import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { resetPhase } from "../../src/app/resetPhase.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId, RunId } from "../../src/domain/branded.js";
import { claudePermissionFlags } from "../../src/domain/session/claudePermissionFlags.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeLock } from "../../src/infra/fakes/lock.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type GateStep,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { decodeSecurityPosture } from "../../src/schemas/securityPosture.js";
import { liftFixturePhaxPlanToCurrent } from "../helpers/liftFixturePhaxPlan.js";
import { planMdFor } from "../helpers/planMarkdown.js";
import { processOutput } from "../helpers/processOutput.js";

// Acceptance tests for partial commands in a run: the prompt's partial lines,
// the Claude Code allow rules, the "partial" source in security.json, resume,
// and provider-agnostic rendering. Marked as expected failures until phase-04
// wires them; phase-04 removes the markers.

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

const shortName = Either.getOrThrow(decodeShortName("my-run"));
const PHASE_IDS = ["phase-01", "phase-02"] as const;

const rawPlanFor = (model: string) => ({
  version: 1,
  run: { shortName: "my-run", title: "My Run", branch: "ai/my-run", requiredCommands: [] },
  phases: PHASE_IDS.map((id, i) => ({
    id,
    title: `Phase ${i + 1}`,
    model,
    effort: "low" as const,
    planMarkdownAnchor: `#${id}-work`,
    plannedFilesToCreate: [`src/new-${i + 1}.ts`],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    commit: { subject: `ai(${id}): step ${i + 1}`, body: `Does step ${i + 1}.` },
  })),
});

/** Only `only` enabled, so every phase runs on it. */
const onlyProvider = (only: string): ProviderConfig => ({
  providers: Object.fromEntries(
    Object.entries(DEFAULT_PROVIDER_CONFIG.providers).map(([id, provider]) => [
      id,
      { ...provider, enabled: id === only },
    ]),
  ) as ProviderConfig["providers"],
});

// The fixture profile: two every-phase steps with partials, one without, and a
// terminal product step with a partial.
const PROFILE: readonly GateStep[] = [
  {
    command: "pnpm lint",
    surface: "local",
    firing: "every-phase",
    output: "log",
    partial: {
      files: "pnpm exec oxlint <files>",
      diff: "git diff --name-only --diff-filter=d | xargs pnpm exec oxlint",
    },
  },
  {
    command: "pnpm test",
    surface: "local",
    firing: "every-phase",
    output: "log",
    partial: { files: "pnpm exec vitest run <files>" },
  },
  { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
  {
    command: "pnpm build",
    surface: "product",
    firing: "terminal",
    output: "log",
    partial: { files: "pnpm exec vite build <files>" },
  },
];

// Segment prefixes, computed by hand: the words before the placeholder word.
const PARTIAL_PREFIXES = [
  "pnpm exec oxlint",
  "git diff --name-only --diff-filter=d",
  "xargs pnpm exec oxlint",
  "pnpm exec vitest run",
  "pnpm exec vite build",
] as const;

const LINT_LINES = [
  "- local: pnpm lint",
  "  - on some files: pnpm exec oxlint <files>",
  "  - on your changes: git diff --name-only --diff-filter=d | xargs pnpm exec oxlint",
];

/** The `## Gate` section: from the heading line to the next `## ` heading. */
function gateSectionOf(prompt: string): string {
  const lines = prompt.split("\n");
  const start = lines.findIndex((l) => l === "## Gate");
  expect(start, "prompt.md has a `## Gate` heading").toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return lines.slice(start, start + 1 + (end === -1 ? rest.length : end)).join("\n");
}

function makeConfig(
  root: string,
  opts: { secure?: boolean; agentCommands?: readonly string[] } = {},
): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: "test-project",
      state: { root },
      gateProfiles: { full: PROFILE as never },
      commands: { setup: ["true"], cleanup: ["true"] },
    },
    stateRoot: root,
    namespace: "test-project",
    repoRoot: root,
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
      profile: opts.secure === true ? "secure" : "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [...(opts.agentCommands ?? [])],
    },
    publish: resolvePublishConfig(undefined),
    complianceReview: resolveComplianceReviewConfig(undefined),
    codeReview: resolveCodeReviewConfig(undefined),
    authoring: resolveAuthoringConfig(undefined),
  };
}

function makeRun(
  root: string,
  config: ResolvedConfig,
  opts: { failCommand?: string; model?: string; provider?: string; secure?: boolean } = {},
) {
  const runPlan = rawPlanFor(opts.model ?? "claude-sonnet-4-6");
  const plan = Either.getOrThrow(liftFixturePhaxPlanToCurrent("phax-plan.json", runPlan)).plan;
  const planMd = planMdFor(runPlan);
  const worktreeOf = (phaseId: string) => join(root, "worktrees", "test-project.my-run", phaseId);

  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false, true);
  fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-02"), false);

  // Every gate command answers exit 0, except the one a test asks to fail.
  const fakeShell = makeFakeShell();
  for (const command of ["true", "git diff HEAD^ HEAD", ...PROFILE.map((s) => s.command)]) {
    const failing = command === opts.failCommand;
    fakeShell.impl.setResponse(command, {
      exitCode: failing ? 1 : 0,
      stdout: "",
      stderr: failing ? "red" : "",
    });
  }
  fakeShell.impl.setResponse("git rev-parse HEAD", {
    exitCode: 0,
    stdout: "deadbeef12345678\n",
    stderr: "",
  });

  const session = (id: string) => ({
    sessionId: id as ClaudeSessionId,
    outputPath: "",
    finalText: "",
  });
  const fakeBackend = makeFakeBackend();
  for (const id of ["sess-01", "sess-02"]) fakeBackend.impl.addRunResponse(session(id));
  const resumeIds = opts.failCommand === undefined ? ["sess-01-h", "sess-02-h"] : ["sess-01-fix"];
  for (const id of resumeIds) fakeBackend.impl.addResumeResponse(session(id));

  const layers = Layer.mergeAll(
    fakeGit.layer,
    fakeShell.layer,
    fakeBackend.layer,
    NodeFileSystemLayer,
    NoopSystemTelemetryLayer,
    makeFakeGitHub().layer,
  );

  const execute = (runPath: string, runId: RunId, startIndex: number) =>
    Effect.runPromise(
      Effect.either(
        executePlan({
          phaxVersion: "0.0.0-test",
          output: processOutput,
          shortName,
          namespace: "test-project",
          plan,
          planMd,
          config,
          gateProfileId: "full",
          allowDirty: startIndex > 0,
          runPath,
          runId,
          startIndex,
          ...(opts.secure === true ? { securityMode: "secure" as const } : {}),
          ...(opts.provider === undefined
            ? {}
            : { routing: DEFAULT_MODEL_ROUTING, providerConfig: onlyProvider(opts.provider) }),
        }).pipe(Effect.provide(layers)),
      ),
    );

  return {
    fakeGit,
    fakeShell,
    fakeBackend,
    layers,
    worktreeOf,
    execute,
    async startRun() {
      for (const phaseId of PHASE_IDS) {
        await mkdir(join(worktreeOf(phaseId), ".phax-context"), { recursive: true });
        await writeFile(
          join(worktreeOf(phaseId), ".phax-context", "phase-handoff.md"),
          HANDOFF_CONTENT,
        );
      }
      const { runPath, runId } = await Effect.runPromise(
        createRunFolder(shortName, planMd, plan, config).pipe(Effect.provide(layers)),
      );
      const result = await execute(runPath, runId, 0);
      return { runPath, runId, result };
    },
  };
}

type Scenario = ReturnType<typeof makeRun>;

const readPrompt = (runPath: string, phaseId: string) =>
  readFile(join(runPath, phaseId, "prompt.md"), "utf8");

async function readPosture(runPath: string, phaseId = "phase-01") {
  return Either.getOrThrow(
    decodeSecurityPosture(
      JSON.parse(await readFile(join(runPath, phaseId, "security.json"), "utf8")),
    ),
  );
}

/** The partial prefixes among a list of frozen agent commands, in list order. */
const partialsIn = (commands: readonly string[] | undefined) =>
  (commands ?? []).filter((c) => (PARTIAL_PREFIXES as readonly string[]).includes(c));

/** The fake backend does not record the session id; do it as the real writer would. */
async function recordSessionId(runPath: string, id: string) {
  const statusPath = join(runPath, "phase-01", "status.json");
  const status = JSON.parse(await readFile(statusPath, "utf8")) as Record<string, unknown>;
  await writeFile(statusPath, JSON.stringify({ ...status, claudeSessionId: id }));
}

function allowedToolsOf(s: Scenario): string[] {
  const first = s.fakeBackend.impl.runCalls[0];
  expect(first?.options.provider).toBe("claude-code");
  if (first === undefined) throw new Error("no run call");
  const flags = claudePermissionFlags({
    security: first.options.security,
    cwd: first.options.cwd,
    agentCommands: first.options.agentCommands ?? [],
    grantSettings: undefined,
  });
  const at = flags.indexOf("--allowedTools");
  expect(at, "the flags carry --allowedTools").toBeGreaterThanOrEqual(0);
  return (flags[at + 1] ?? "").split(",");
}

describe("partial commands in a run (acceptance)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "phax-partial-run-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function runFull() {
    const s = makeRun(root, makeConfig(root));
    const { runPath, result } = await s.startRun();
    expect(Either.isRight(result)).toBe(true);
    return {
      first: gateSectionOf(await readPrompt(runPath, "phase-01")),
      second: gateSectionOf(await readPrompt(runPath, "phase-02")),
    };
  }

  it.fails("ac-prompt-lines: partial lines sit under their step, verbatim", async () => {
    const { first } = await runFull();
    const lines = first.split("\n");
    const at = lines.indexOf("- local: pnpm lint");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines.slice(at, at + 3)).toEqual(LINT_LINES);
    const test = lines.indexOf("- local: pnpm test");
    expect(lines.slice(test, test + 2)).toEqual([
      "- local: pnpm test",
      "  - on some files: pnpm exec vitest run <files>",
    ]);
    expect(lines[test + 2]).toMatch(/^- /);
    // Steps without partial have no partial line under them.
    const typecheck = lines.indexOf("- local: pnpm typecheck");
    expect(typecheck).toBeGreaterThanOrEqual(0);
    expect(lines[typecheck + 1] ?? "").not.toMatch(/^ {2}- on /);
    expect(first.match(/on some files:/g)).toHaveLength(2);
    expect(first.match(/on your changes:/g)).toHaveLength(1);
  });

  it.fails("ac-prompt-explains: the section explains partials and names no tool", async () => {
    const { first } = await runFull();
    expect(first).toContain("check part of what the step checks");
    expect(first).toContain("Replace a placeholder such as <files> with the files you choose");
    expect(first).toContain("phax does not run these commands");
    const fixed = first
      .split("\n")
      .filter((l) => !l.startsWith("- ") && !l.startsWith("  - on "))
      .join("\n");
    for (const tool of ["pnpm", "npm", "vitest", "oxlint", "cargo"]) {
      expect(fixed).not.toContain(tool);
    }
    expect(fixed).not.toMatch(/\bgit\b/);
  });

  it.fails("ac-terminal-partials: a terminal step's lines appear on the terminal phase only", async () => {
    const { first, second } = await runFull();
    expect(second).toContain(
      "- product: pnpm build\n  - on some files: pnpm exec vite build <files>",
    );
    expect(first).not.toContain("pnpm build");
    expect(first).not.toContain("pnpm exec vite build");
  });

  it.fails("ac-claude-rules: one Claude allow rule per partial segment, none with a placeholder or pipe", async () => {
    const s = makeRun(root, makeConfig(root, { secure: true }), { secure: true });
    const { result } = await s.startRun();
    expect(Either.isRight(result)).toBe(true);
    const rules = allowedToolsOf(s);
    for (const prefix of PARTIAL_PREFIXES) {
      expect(rules).toContain(`Bash(${prefix}:*)`);
    }
    for (const rule of rules) {
      expect(rule).not.toMatch(/[<>|]/);
    }
  });

  it.fails("ac-security-json: partial prefixes are recorded with source partial", async () => {
    const config = makeConfig(root, { secure: true, agentCommands: ["pnpm exec oxlint"] });
    const s = makeRun(root, config, { secure: true });
    const { runPath, result } = await s.startRun();
    expect(Either.isRight(result)).toBe(true);
    const records = (await readPosture(runPath)).agentCommands;

    const partials = records.filter((r) => (r.source as string) === "partial");
    expect(partials.map((r) => r.command).toSorted()).toEqual(
      [
        "git diff --name-only --diff-filter=d",
        "pnpm exec vite build",
        "pnpm exec vitest run",
        "xargs pnpm exec oxlint",
      ].toSorted(),
    );
    for (const r of partials) {
      expect(r.explicit).toBe(false);
      expect(r.requiredByPlan).toBe(false);
    }
    // A prefix already granted by config is recorded once, as config.
    const oxlint = records.filter((r) => r.command === "pnpm exec oxlint");
    expect(oxlint).toHaveLength(1);
    expect(oxlint[0]?.source).toBe("config");
    for (const r of records) expect(r.command).not.toMatch(/[<|]/);
  });

  it.fails("ac-resume: a relaunched phase keeps its partial lines and prefixes", async () => {
    const config = makeConfig(root, { secure: true });
    const s = makeRun(root, config, { failCommand: "pnpm test", secure: true });
    const { runPath, runId } = await s.startRun();
    const promptPath = join(runPath, "phase-01", "prompt.md");
    const firstSection = gateSectionOf(await readFile(promptPath, "utf8"));
    expect(firstSection).toContain(LINT_LINES[1]);
    const firstPartials = partialsIn(s.fakeBackend.impl.runCalls[0]?.options.agentCommands);
    expect(firstPartials).toEqual(expect.arrayContaining([...PARTIAL_PREFIXES]));

    await recordSessionId(runPath, "sess-01");
    const reset = await Effect.runPromise(
      Effect.either(
        resetPhase({
          shortName,
          namespace: "test-project",
          phaseId: "phase-01",
          stateRoot: root,
          repoRoot: root,
        }).pipe(Effect.provide(s.layers), Effect.provide(makeFakeLock().layer)),
      ),
    );
    expect(Either.isRight(reset)).toBe(true);

    s.fakeShell.impl.setResponse("pnpm test", { exitCode: 0, stdout: "", stderr: "" });
    s.fakeGit.impl.enqueueWorktreeIsClean(s.worktreeOf("phase-01"), false, true);
    s.fakeGit.impl.enqueueWorktreeIsClean(s.worktreeOf("phase-02"), false);
    for (const id of ["sess-01b", "sess-02b"]) {
      s.fakeBackend.impl.addRunResponse({
        sessionId: id as ClaudeSessionId,
        outputPath: "",
        finalText: "",
      });
      s.fakeBackend.impl.addResumeResponse({
        sessionId: `${id}-handoff` as ClaudeSessionId,
        outputPath: "",
        finalText: "",
      });
    }
    const callsBefore = s.fakeBackend.impl.runCalls.length;
    const resumed = await s.execute(runPath, runId, 0);
    expect(Either.isRight(resumed)).toBe(true);

    expect(gateSectionOf(await readFile(promptPath, "utf8"))).toBe(firstSection);
    const relaunch = s.fakeBackend.impl.runCalls[callsBefore];
    expect(partialsIn(relaunch?.options.agentCommands)).toEqual(firstPartials);
  });

  it.fails("ac-resume: a resumed session keeps the same partial prefixes", async () => {
    // The gate never passes, so phase-01 stops in gates_exhausted with a binding;
    // a second execute re-enters its session through the binding path of executePlan.
    const config = makeConfig(root, { secure: true });
    const s = makeRun(root, config, { failCommand: "pnpm test", secure: true });
    for (let i = 0; i < 4; i++) {
      s.fakeBackend.impl.addResumeResponse({
        sessionId: `sess-01-${i}` as ClaudeSessionId,
        outputPath: "",
        finalText: "",
      });
    }
    const { runPath, runId } = await s.startRun();
    const firstPartials = partialsIn(s.fakeBackend.impl.runCalls[0]?.options.agentCommands);
    expect(firstPartials).toEqual(expect.arrayContaining([...PARTIAL_PREFIXES]));

    await recordSessionId(runPath, "sess-01");
    const before = s.fakeBackend.impl.resumeCalls.length;
    await s.execute(runPath, runId, 0);
    const resumeCalls = s.fakeBackend.impl.resumeCalls.slice(before);
    expect(resumeCalls.length).toBeGreaterThan(0);
    for (const call of resumeCalls) {
      expect(partialsIn(call.options.agentCommands)).toEqual(firstPartials);
    }
  });

  it.fails("ac-providers: the gate section, partial lines included, is identical on every provider", async () => {
    const received = new Map<string, string>();
    for (const [provider, model] of [
      ["claude-code", "claude-sonnet-4-6"],
      ["codex-cli", "gpt-6-sol"],
      // A plan names Claude-hub or catalog ids; Vibe serves a Claude id through its alias.
      ["mistral-vibe", "claude-sonnet-4-6"],
    ] as const) {
      const at = join(root, provider);
      await mkdir(at, { recursive: true });
      const s = makeRun(at, makeConfig(at), { model, provider });
      const { result } = await s.startRun();
      expect(Either.isRight(result)).toBe(true);
      const first = s.fakeBackend.impl.runCalls[0];
      expect(first?.options.provider).toBe(provider);
      const section = gateSectionOf(first?.prompt ?? "");
      expect(section).toContain(LINT_LINES[1]);
      received.set(provider, section);
    }
    expect(new Set(received.values()).size).toBe(1);
  });
});
