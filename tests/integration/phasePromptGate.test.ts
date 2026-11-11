import { Effect, Result, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { resetPhase } from "../../src/app/resetPhase.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { resolveGateProfile } from "../../src/app/gates.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId, RunId } from "../../src/domain/branded.js";
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
  decodePhaxConfig,
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type GateStep,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { liftFixturePhaxPlanToCurrent } from "../helpers/liftFixturePhaxPlan.js";
import { planMdFor } from "../helpers/planMarkdown.js";
import { processOutput } from "../helpers/processOutput.js";

// Acceptance tests for the spec's §6 surface: each phase's prompt.md carries a
// `## Gate` section listing the phase gate list. Marked as expected failures
// until phase-02 renders the section; phase-02 removes the markers.

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

const shortName = Result.getOrThrow(decodeShortName("my-run"));

const GIT_COMMIT_LINE =
  "Do not run `git commit` yourself — phax commits your changes after gates pass.";

const rawPlanFor = (model: string) => ({
  version: 1,
  run: { shortName: "my-run", title: "My Run", branch: "ai/my-run", requiredCommands: [] },
  phases: (["01", "02"] as const).map((n) => ({
    id: `phase-${n}`,
    title: `Phase ${n}`,
    model,
    effort: "low" as const,
    planMarkdownAnchor: `#phase-${n}-work`,
    plannedFilesToCreate: [`src/new-${n}.ts`],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    commit: { subject: `ai(phase-${n}): step ${n}`, body: `Does step ${n}.` },
  })),
});

const rawPlan = rawPlanFor("claude-sonnet-4-6");

/** Only `only` enabled, so every phase runs on it. */
const onlyProvider = (only: string): ProviderConfig => ({
  providers: Object.fromEntries(
    Object.entries(DEFAULT_PROVIDER_CONFIG.providers).map(([id, provider]) => [
      id,
      { ...provider, enabled: id === only },
    ]),
  ) as ProviderConfig["providers"],
});

const baseStep = (command: string, firing: "every-phase" | "terminal") => ({
  command,
  surface: "local" as const,
  firing,
  output: "log" as const,
});

const PHASE_IDS = ["phase-01", "phase-02"] as const;

/** The `## Gate` section: from the heading line to the next `## ` heading. */
function gateSectionOf(prompt: string): string {
  const lines = prompt.split("\n");
  const start = lines.findIndex((l) => l === "## Gate");
  expect(start, "prompt.md has a `## Gate` heading").toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n");
  expect(body.trim().length, "the `## Gate` section is not empty").toBeGreaterThan(0);
  return lines.slice(start, start + 1 + (end === -1 ? rest.length : end)).join("\n");
}

/** The `- <surface>: <command>` lines of a gate section. */
function stepLinesOf(section: string): string[] {
  return section.split("\n").filter((l) => l.startsWith("- "));
}

function expectedLines(steps: readonly GateStep[]): string[] {
  return steps.map((s) => `- ${s.surface}: ${s.command}`);
}

async function standardProfile(): Promise<readonly GateStep[]> {
  const raw: unknown = JSON.parse(await readFile(join(process.cwd(), "phax.json"), "utf8"));
  const config = Result.getOrThrow(decodePhaxConfig(raw));
  const steps = config.gateProfiles["standard"];
  if (steps === undefined) throw new Error("phax.json has no standard gate profile");
  return steps;
}

function makeConfig(
  root: string,
  gateProfiles: ResolvedConfig["raw"]["gateProfiles"],
  workspaces?: ResolvedConfig["raw"]["workspaces"],
): ResolvedConfig {
  return {
    raw: {
      version: 1,
      name: "test-project",
      state: { root },
      gateProfiles,
      ...(workspaces === undefined ? {} : { workspaces }),
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
  };
}

function makeRun(
  root: string,
  config: ResolvedConfig,
  workspaceId?: string,
  opts: { failCommand?: string; model?: string; provider?: string } = {},
) {
  const runPlan = opts.model === undefined ? rawPlan : rawPlanFor(opts.model);
  const plan = Result.getOrThrow(liftFixturePhaxPlanToCurrent("phax-plan.json", runPlan)).plan;
  const planMd = planMdFor(runPlan);
  const worktreeOf = (phaseId: string) => join(root, "worktrees", "test-project.my-run", phaseId);

  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-01"), false, true);
  fakeGit.impl.enqueueWorktreeIsClean(worktreeOf("phase-02"), false);

  // Every gate command answers exit 0, except the one a test asks to fail.
  const fakeShell = makeFakeShell();
  const commands = new Set<string>(["true", "git diff HEAD^ HEAD"]);
  for (const steps of [
    ...Object.values(config.raw.gateProfiles),
    ...(config.raw.workspaces ?? []).flatMap((w) => Object.values(w.gateProfiles ?? {})),
  ]) {
    for (const step of steps) commands.add(step.command);
  }
  for (const command of commands) {
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

  const fakeBackend = makeFakeBackend();
  for (const id of ["sess-01", "sess-02"]) {
    fakeBackend.impl.addRunResponse({
      sessionId: id as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
  }
  const resumeIds = opts.failCommand === undefined ? ["sess-01-h", "sess-02-h"] : ["sess-01-fix"];
  for (const id of resumeIds) {
    fakeBackend.impl.addResumeResponse({
      sessionId: id as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
  }

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
      Effect.result(
        executePlan({
          phaxVersion: "0.0.0-test",
          output: processOutput,
          shortName,
          namespace: "test-project",
          plan,
          planMd,
          config,
          gateProfileId: "full",
          workspaceId,
          allowDirty: startIndex > 0,
          runPath,
          runId,
          startIndex,
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

async function readPrompts(runPath: string): Promise<Record<string, string>> {
  const prompts: Record<string, string> = {};
  for (const phaseId of PHASE_IDS) {
    prompts[phaseId] = await readFile(join(runPath, phaseId, "prompt.md"), "utf8");
  }
  return prompts;
}

describe("phase prompt names the gate (acceptance)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "phax-prompt-gate-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function runStandard() {
    const profile = await standardProfile();
    const everyPhase = profile.filter((s) => s.firing === "every-phase");
    const terminal = profile.filter((s) => s.firing === "terminal");
    // The fixture is pinned to the spec's counts.
    expect(everyPhase).toHaveLength(9);
    expect(terminal).toHaveLength(4);
    const s = makeRun(root, makeConfig(root, { full: profile as never }));
    const { runPath, result } = await s.startRun();
    expect(Result.isSuccess(result)).toBe(true);
    return { profile, everyPhase, terminal, prompts: await readPrompts(runPath) };
  }

  it("ac-nonterminal-list: phase-01 lists exactly the every-phase steps", async () => {
    const { everyPhase, terminal, prompts } = await runStandard();
    const prompt = prompts["phase-01"] ?? "";
    const section = gateSectionOf(prompt);
    expect(stepLinesOf(section)).toEqual(expectedLines(everyPhase));
    for (const step of terminal) {
      expect(prompt).not.toContain(step.command);
    }
  });

  it("ac-terminal-list: the terminal phase lists every-phase then terminal steps", async () => {
    const { everyPhase, terminal, prompts } = await runStandard();
    const section = gateSectionOf(prompts["phase-02"] ?? "");
    expect(stepLinesOf(section)).toEqual(expectedLines([...everyPhase, ...terminal]));
  });

  it("ac-prompt-equals-gate: listed commands equal the commands the gate ran", async () => {
    const config = makeConfig(
      root,
      { full: [baseStep("echo base-a", "every-phase"), baseStep("echo base-b", "terminal")] },
      [
        {
          id: "ws",
          name: "Workspace",
          path: ".",
          gateProfiles: {
            full: [
              { ...baseStep("echo ws-a", "every-phase"), surface: "local" },
              { ...baseStep("echo ws-b", "terminal"), surface: "product" },
              { ...baseStep("echo ws-c", "every-phase"), surface: "structural" },
              { ...baseStep("echo ws-d", "terminal"), surface: "product" },
              { ...baseStep("echo ws-e", "every-phase"), surface: "local" },
            ],
          },
        },
      ],
    );
    const profile = resolveGateProfile(config, "full", "ws");
    expect(profile.map((s) => s.command)).toEqual([
      "echo ws-a",
      "echo ws-b",
      "echo ws-c",
      "echo ws-d",
      "echo ws-e",
    ]);
    const s = makeRun(root, config, "ws");
    const { runPath, result } = await s.startRun();
    expect(Result.isSuccess(result)).toBe(true);
    const prompts = await readPrompts(runPath);

    for (const phaseId of PHASE_IDS) {
      const log = await readFile(join(runPath, phaseId, "checks-attempt-01.log"), "utf8");
      const ran = log
        .split("\n")
        .filter((l) => l.startsWith("$ echo "))
        .map((l) => l.slice(2));
      expect(ran.length).toBeGreaterThan(0);
      const listed = stepLinesOf(gateSectionOf(prompts[phaseId] ?? "")).map((l) =>
        l.replace(/^- [a-z]+: /, ""),
      );
      expect(listed).toEqual(ran);
    }
  });

  it("ac-contract: every gate section states the gate contract", async () => {
    const { prompts } = await runStandard();
    for (const phaseId of PHASE_IDS) {
      const section = gateSectionOf(prompts[phaseId] ?? "");
      expect(section).toContain("phax runs these gate steps");
      expect(section).toContain("resumes this same session with its output");
      expect(section).toContain("the narrowest command that covers it");
      expect(section).toContain("need not run a whole gate step");
    }
  });

  it("ac-no-rerun: no rerun instruction and no unfiltered command list", async () => {
    const { profile, terminal, prompts } = await runStandard();
    const bare = profile.map((s) => s.command);
    for (const phaseId of PHASE_IDS) {
      const prompt = prompts[phaseId] ?? "";
      // The gate section is required first, so this never passes vacuously.
      gateSectionOf(prompt);
      expect(prompt).not.toContain("Run the gate commands again");
      expect(prompt).toContain(GIT_COMMIT_LINE);
      const lines = prompt.split("\n").map((l) => l.trim());
      if (phaseId === "phase-01") {
        for (const step of terminal) expect(lines).not.toContain(step.command);
      }
      const wholeProfileAsBareLines = lines.some((_, i) =>
        bare.every((command, j) => lines[i + j] === command),
      );
      expect(wholeProfileAsBareLines).toBe(false);
    }
  });

  it("ac-resume: a regenerated phase-01 prompt keeps its gate section", async () => {
    const profile = await standardProfile();
    const config = makeConfig(root, { full: profile as never });
    const s = makeRun(root, config, undefined, { failCommand: "pnpm test" });
    const { runPath, runId } = await s.startRun();
    const promptPath = join(runPath, "phase-01", "prompt.md");
    const firstSection = gateSectionOf(await readFile(promptPath, "utf8"));

    // The fake backend does not record the session id; do it as the real writer would.
    const statusPath = join(runPath, "phase-01", "status.json");
    const status = JSON.parse(await readFile(statusPath, "utf8")) as Record<string, unknown>;
    await writeFile(statusPath, JSON.stringify({ ...status, claudeSessionId: "sess-01" }));

    const reset = await Effect.runPromise(
      Effect.result(
        resetPhase({
          shortName,
          namespace: "test-project",
          phaseId: "phase-01",
          stateRoot: root,
          repoRoot: root,
        }).pipe(Effect.provide(s.layers), Effect.provide(makeFakeLock().layer)),
      ),
    );
    expect(Result.isSuccess(reset)).toBe(true);

    // With the gate fixed, resuming starts phase-01 fresh and regenerates its prompt.
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
    const resumed = await s.execute(runPath, runId, 0);
    expect(Result.isSuccess(resumed)).toBe(true);

    expect(gateSectionOf(await readFile(promptPath, "utf8"))).toBe(firstSection);
  });

  it("ac-agnostic: the gate section each provider receives is byte-identical and names no tool", async () => {
    const profile = await standardProfile();
    const received = new Map<string, string>();
    for (const [provider, model] of [
      ["claude-code", "claude-sonnet-4-6"],
      ["codex-cli", "gpt-6-sol"],
      // A plan names Claude-hub or catalog ids; Vibe serves a Claude id through its alias.
      ["mistral-vibe", "claude-sonnet-4-6"],
    ] as const) {
      const at = join(root, provider);
      await mkdir(at, { recursive: true });
      const s = makeRun(at, makeConfig(at, { full: profile as never }), undefined, {
        model,
        provider,
      });
      const { result } = await s.startRun();
      expect(Result.isSuccess(result)).toBe(true);
      const first = s.fakeBackend.impl.runCalls[0];
      expect(first?.options.provider).toBe(provider);
      received.set(provider, gateSectionOf(first?.prompt ?? ""));
    }
    const sections = [...received.values()];
    expect(new Set(sections).size).toBe(1);
    const fixed = (sections[0] ?? "")
      .split("\n")
      .filter((l) => !l.startsWith("- "))
      .join("\n");
    for (const tool of ["pnpm", "npm", "vitest", "jest", "cargo"]) {
      expect(fixed).not.toContain(tool);
    }
  });
});
