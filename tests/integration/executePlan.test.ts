import { Effect, Either, Layer } from "effect";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { readAgentBinding } from "../../src/app/agentBinding.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import {
  AgentSessionIdMissingError,
  GateAttemptsExhaustedError,
  SecurityPreflightError,
} from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../src/schemas/phaxPlan.js";

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

// Seed a run that is paused in `interrupted` with phase-01 in `gates_exhausted`,
// mirroring the on-disk shape the reducer / dispatcher would leave behind after
// FixAttemptsExhausted.
async function seedGatesExhaustedRun(opts: {
  runPath: string;
  worktreePath: string;
  claudeSessionId?: string | undefined;
}): Promise<void> {
  const now = new Date().toISOString();
  const runStatus = {
    version: 1,
    shortName: "my-run",
    runId: "my-run-2026-06-11",
    state: "interrupted",
    createdAt: now,
    updatedAt: now,
    phasesCount: 1,
    currentPhaseIndex: 0,
    gateProfileId: "full",
    stoppedReason: "gates_exhausted",
    lastError: "Gate failed: true",
  };
  await writeFile(join(opts.runPath, "run-status.json"), JSON.stringify(runStatus, null, 2));

  const phaseFolder = join(opts.runPath, "phase-01");
  await mkdir(phaseFolder, { recursive: true });
  const phaseStatus: Record<string, unknown> = {
    version: 1,
    phaseId: "phase-01",
    phaseIndex: 0,
    state: "gates_exhausted",
    model: "claude-sonnet-4-6",
    effort: "low",
    createdAt: now,
    updatedAt: now,
    branchName: "ai/my-run--phase-01",
    worktreePath: opts.worktreePath,
  };
  if (opts.claudeSessionId !== undefined) {
    phaseStatus.claudeSessionId = opts.claudeSessionId;
  }
  await writeFile(join(phaseFolder, "status.json"), JSON.stringify(phaseStatus, null, 2));

  // A real gates_exhausted run always has an agent-binding.json (written at
  // phase launch). Resume reads the locked binding and never re-routes, so seed
  // it here. Tests that exercise a different provider overwrite this afterward.
  const binding = {
    version: 1,
    shortName: "my-run",
    runId: "my-run-2026-06-11",
    phaseId: "phase-01",
    phaseIndex: 0,
    phaseName: "First Phase",
    provider: "claude-code",
    adapter: "claude",
    model: "claude-sonnet-4-6",
    effort: "low",
    sessionId: opts.claudeSessionId ?? null,
    sessionHandle: null,
    worktreePath: opts.worktreePath,
    cwd: opts.worktreePath,
    launchedAt: now,
    status: "running",
  };
  await writeFile(join(phaseFolder, "agent-binding.json"), JSON.stringify(binding, null, 2));

  // Simulate that one gate attempt (and one fix) already ran before the
  // budget was exhausted. The resume path must continue numbering past these.
  await writeFile(join(phaseFolder, "checks-attempt-01.log"), "gate failed\n");
  await writeFile(join(phaseFolder, "fix-attempt-01.jsonl"), "");
}

const rawPlan = {
  version: 1,
  run: {
    shortName: "my-run",
    title: "My Run",
    branch: "ai/my-run",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "First Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
    {
      id: "phase-02",
      title: "Second Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-02-second",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-02): do more", body: "Does more." },
    },
  ],
} as const;

describe("executePlan — happy-path 2-phase run", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-"));

    // Pre-create worktree directories so generatePhaseHandoff can find the handoff files.
    // FakeGit's addWorktree does not create real directories; we create them here to simulate
    // the agent having written .phax-context/phase-handoff.md in the worktree.
    const phase01Worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    const phase02Worktree = join(stateRoot, "worktrees", "my-run", "phase-02");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    await mkdir(join(phase02Worktree, ".phax-context"), { recursive: true });
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
    await writeFile(join(phase02Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("drives both phases to review_open and writes all expected artifacts", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        project: { name: "test-project", type: "single-package" },
        state: { root: stateRoot },
        gateProfiles: { full: ["true"] },
        commands: { setup: ["true"], cleanup: ["true"] },
      },
      stateRoot,
      repoRoot: stateRoot,
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
      fileReconciliationMode: "report_only" as const,

      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only", allowDomains: [] },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
      },
    };

    const phase01WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");
    const phase02WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-02");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    // phase-01: dirty for commitPhase, then clean for cleanupPhase
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false, true);
    // phase-02 (final): dirty for commitPhase; cleanupPhase is skipped for final phases
    fakeGit.impl.enqueueWorktreeIsClean(phase02WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-02" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-02-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    // Phase-04: every backend.runAgent call receives a resolved SecurityPolicy.
    // Default profile is `unsafe`, so failClosed is false and the allow-lists are empty.
    expect(fakeBackend.impl.runCalls).toHaveLength(2);
    for (const call of fakeBackend.impl.runCalls) {
      expect(call.options.security.mode).toBe("unsafe");
      expect(call.options.security.failClosed).toBe(false);
    }

    const phase01Status = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string; worktreePath?: string; commitHash?: string };
    expect(phase01Status.state).toBe("cleaned_up");
    expect(phase01Status.worktreePath).toBe(phase01WorktreePath);
    expect(phase01Status.commitHash).toBe("deadbeef12345678");

    const phase02Status = JSON.parse(
      await readFile(join(runPath, "phase-02", "status.json"), "utf8"),
    ) as { state: string };
    expect(phase02Status.state).toBe("review_open");

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");

    const reviewHandoff = await readFile(join(runPath, "review-handoff.md"), "utf8");
    expect(reviewHandoff).toContain("my-run");
    expect(reviewHandoff).toContain("ai/my-run");

    const finalReport = await readFile(join(runPath, "final-report.md"), "utf8");
    expect(finalReport).toContain("my-run");

    const registry = JSON.parse(await readFile(join(stateRoot, "registry.json"), "utf8")) as {
      runs: Array<{ shortName: string; state: string }>;
    };
    const entry = registry.runs.find((r) => r.shortName === "my-run");
    expect(entry?.state).toBe("review_open");

    // agent-binding.json must exist in each phase folder with correct locked provider/model.
    const phase01Binding = await readAgentBinding(join(runPath, "phase-01"));
    expect(Either.isRight(phase01Binding)).toBe(true);
    if (Either.isRight(phase01Binding)) {
      expect(phase01Binding.right.provider).toBe("claude-code");
      expect(phase01Binding.right.adapter).toBe("claude");
      expect(phase01Binding.right.model).toBe("claude-sonnet-4-6");
      expect(phase01Binding.right.sessionId).toBe("sess-01");
      expect(phase01Binding.right.status).toBe("completed");
      expect(phase01Binding.right.phaseId).toBe("phase-01");
    }

    const phase02Binding = await readAgentBinding(join(runPath, "phase-02"));
    expect(Either.isRight(phase02Binding)).toBe(true);
    if (Either.isRight(phase02Binding)) {
      expect(phase02Binding.right.sessionId).toBe("sess-02");
      expect(phase02Binding.right.status).toBe("awaiting_manual_review");
      expect(phase02Binding.right.phaseId).toBe("phase-02");
    }

    // Cleanup must not remove intermediate-phase worktrees — they persist until archive.
    await expect(access(phase01WorktreePath)).resolves.toBeUndefined();
    await expect(access(phase02WorktreePath)).resolves.toBeUndefined();
  });

  it("returns committed phase ids and final worktree path", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        project: { name: "test-project", type: "single-package" },
        state: { root: stateRoot },
        gateProfiles: { full: ["true"] },
        commands: { setup: ["true"], cleanup: ["true"] },
      },
      stateRoot,
      repoRoot: stateRoot,
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
      fileReconciliationMode: "report_only" as const,

      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only", allowDomains: [] },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
      },
    };

    const phase01WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");
    const phase02WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-02");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false, true);
    fakeGit.impl.enqueueWorktreeIsClean(phase02WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "cafebabe\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-02" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-h" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-02-h" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.committedPhases).toEqual(["phase-01", "phase-02"]);
      expect(result.right.finalPhaseId).toBe("phase-02");
      expect(result.right.finalWorktreePath).toBe(phase02WorktreePath);
    }
  });

  it("app-layer patch is the sole owner of the launching→running binding transition", async () => {
    // Regression: executePlan.patchAgentBindingSession (called after backend.runAgent
    // returns) is the only writer of the launching → running transition.
    // persistSessionId (called by real providers during streaming) no longer patches
    // agent-binding.json. This test would fail if the patchAgentBindingSession call
    // were removed from executePlan, proving the app-layer owns binding mutations.
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        project: { name: "test-project", type: "single-package" },
        state: { root: stateRoot },
        gateProfiles: { full: ["true"] },
        commands: { setup: ["true"], cleanup: ["true"] },
      },
      stateRoot,
      repoRoot: stateRoot,
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
      fileReconciliationMode: "report_only" as const,
      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only", allowDomains: [] },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
      },
    };

    const phase01WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");
    const phase02WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-02");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false, true);
    fakeGit.impl.enqueueWorktreeIsClean(phase02WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "aabbcc\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-p1" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-p2" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-p1-h" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-p2-h" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const p1Binding = await readAgentBinding(join(runPath, "phase-01"));
    expect(Either.isRight(p1Binding)).toBe(true);
    if (Either.isRight(p1Binding)) {
      expect(p1Binding.right.status).toBe("completed");
      expect(p1Binding.right.sessionId).toBe("sess-p1");
    }

    const p2Binding = await readAgentBinding(join(runPath, "phase-02"));
    expect(Either.isRight(p2Binding)).toBe(true);
    if (Either.isRight(p2Binding)) {
      expect(p2Binding.right.status).toBe("awaiting_manual_review");
      expect(p2Binding.right.sessionId).toBe("sess-p2");
    }
  });

  it("writes agent-binding.json with status launching before agent runs (pre-agent write guarantee)", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        project: { name: "test-project", type: "single-package" },
        state: { root: stateRoot },
        gateProfiles: { full: ["true"] },
        commands: { setup: ["true"], cleanup: ["true"] },
      },
      stateRoot,
      repoRoot: stateRoot,
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
      fileReconciliationMode: "report_only" as const,
      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only", allowDomains: [] },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
      },
    };

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });

    // No responses queued: the first runAgent call will fail with AgentInvocationError.
    const fakeBackend = makeFakeBackend();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    // Run must fail because the backend has no responses.
    expect(Either.isLeft(result)).toBe(true);

    // agent-binding.json must exist with sessionId null — proving it was written
    // before the agent invocation. Status is 'failed' because tapError patches it
    // after the agent invocation fails.
    const binding = await readAgentBinding(join(runPath, "phase-01"));
    expect(Either.isRight(binding)).toBe(true);
    if (Either.isRight(binding)) {
      expect(binding.right.status).toBe("failed");
      expect(binding.right.sessionId).toBeNull();
      expect(binding.right.provider).toBe("claude-code");
    }
  });
});

function makeStatusTestConfig(root: string): ResolvedConfig {
  return {
    raw: {
      version: 1,
      project: { name: "test-project", type: "single-package" },
      state: { root },
      gateProfiles: { full: ["true"] },
      commands: { setup: ["true"], cleanup: ["true"] },
    },
    stateRoot: root,
    repoRoot: root,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only", allowDomains: [] },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
  };
}

describe("executePlan — binding status lifecycle", () => {
  let stateRoot: string;

  const singlePhaseRawPlanStatus = {
    version: 1,
    run: {
      shortName: "my-run",
      title: "My Run",
      branch: "ai/my-run",
      requiredCommands: [],
    },
    phases: [
      {
        id: "phase-01",
        title: "First Phase",
        model: "claude-sonnet-4-6",
        effort: "low" as const,
        planMarkdownAnchor: "#phase-01-first",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
      },
    ],
  } as const;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-status-test-"));
    const worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(worktree, ".phax-context"), { recursive: true });
    await writeFile(join(worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("sets binding status to awaiting_manual_review for the single (final) phase on success", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(singlePhaseRawPlanStatus));
    const config = makeStatusTestConfig(stateRoot);
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const binding = await readAgentBinding(join(runPath, "phase-01"));
    expect(Either.isRight(binding)).toBe(true);
    if (Either.isRight(binding)) {
      expect(binding.right.status).toBe("awaiting_manual_review");
      expect(binding.right.sessionId).toBe("sess-01");
    }
  });

  it("sets binding status to failed when the agent invocation fails", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(singlePhaseRawPlanStatus));
    const config = makeStatusTestConfig(stateRoot);

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    // No responses queued: the first runAgent call will fail with AgentInvocationError.
    const fakeBackend = makeFakeBackend();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);

    const binding = await readAgentBinding(join(runPath, "phase-01"));
    expect(Either.isRight(binding)).toBe(true);
    if (Either.isRight(binding)) {
      expect(binding.right.status).toBe("failed");
    }
  });
});

describe("executePlan — handoff prompt deviation injection", () => {
  let stateRoot: string;

  // phase-01 plans one create and one edit; the actual commit (seeded via the
  // fake git diff below) touches neither and instead changes two other files.
  // That divergence is exactly what reconciliation must surface in the handoff.
  const deviationRawPlan = {
    version: 1,
    run: {
      shortName: "my-run",
      title: "My Run",
      branch: "ai/my-run",
      requiredCommands: [],
    },
    phases: [
      {
        id: "phase-01",
        title: "First Phase",
        model: "claude-sonnet-4-6",
        effort: "low" as const,
        planMarkdownAnchor: "#phase-01-first",
        plannedFilesToCreate: ["src/planned-new.ts"],
        plannedFilesToEdit: ["src/planned-edit.ts"],
        optionalFilesToEdit: [],
        commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
      },
    ],
  } as const;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-deviation-test-"));
    const worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(worktree, ".phax-context"), { recursive: true });
    await writeFile(join(worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("injects the named deviating files into the handoff prompt passed to the backend", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(deviationRawPlan));
    const config = makeStatusTestConfig(stateRoot);
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);
    // The committed diff diverges from the plan: an unplanned file edited, an
    // unplanned file created, and neither planned file touched. reconcilePhaseFiles
    // diffs HEAD^..HEAD via git.diffNameStatus, so this drives the deviations.
    fakeGit.impl.enqueueDiffNameStatus(worktreePath, [
      { status: "modified", path: "src/unplanned-edit.ts" },
      { status: "added", path: "src/unplanned-new.ts" },
    ]);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    // The handoff is produced by resuming the agent session; find that resume by
    // its output path. The reorder (commit -> reconcile -> handoff) means the
    // reconciliation result is available, so the prompt must carry the concrete,
    // named deviation list rather than the old vague conditional.
    const handoffResume = fakeBackend.impl.resumeCalls.find((c) =>
      c.options.outputJsonlPath?.includes("handoff-generation.jsonl"),
    );
    expect(handoffResume).toBeDefined();
    const prompt = handoffResume?.prompt ?? "";
    expect(prompt).toContain("File-plan deviation report:");
    expect(prompt).toContain(
      "phax compared the files you changed against this phase's plan and found these deviations.",
    );
    expect(prompt).toContain("Unplanned files edited: src/unplanned-edit.ts");
    expect(prompt).toContain("Unplanned files created: src/unplanned-new.ts");
    expect(prompt).toContain("Planned to create but not created: src/planned-new.ts");
    expect(prompt).toContain("Planned to edit but not edited: src/planned-edit.ts");
  });

  it("renders the no-deviation line when the commit matches the plan exactly", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(deviationRawPlan));
    const config = makeStatusTestConfig(stateRoot);
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);
    // Commit matches the plan exactly: the planned create and edit, nothing else.
    fakeGit.impl.enqueueDiffNameStatus(worktreePath, [
      { status: "added", path: "src/planned-new.ts" },
      { status: "modified", path: "src/planned-edit.ts" },
    ]);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const handoffResume = fakeBackend.impl.resumeCalls.find((c) =>
      c.options.outputJsonlPath?.includes("handoff-generation.jsonl"),
    );
    expect(handoffResume).toBeDefined();
    const prompt = handoffResume?.prompt ?? "";
    expect(prompt).toContain("phax found no file-plan deviations for this phase.");
    expect(prompt).not.toContain("Unplanned files");
    expect(prompt).not.toContain("Planned to create but not created");
  });
});

describe("executePlan — resume from gates_exhausted", () => {
  let stateRoot: string;
  const singlePhaseRawPlan = {
    version: 1,
    run: {
      shortName: "my-run",
      title: "My Run",
      branch: "ai/my-run",
      requiredCommands: [],
    },
    phases: [
      {
        id: "phase-01",
        title: "First Phase",
        model: "claude-sonnet-4-6",
        effort: "low" as const,
        planMarkdownAnchor: "#phase-01-first",
        plannedFilesToCreate: [],
        plannedFilesToEdit: [],
        optionalFilesToEdit: [],
        commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
      },
    ],
  } as const;

  const baseConfig = (): ResolvedConfig => ({
    raw: {
      version: 1,
      project: { name: "test-project", type: "single-package" },
      state: { root: stateRoot },
      gateProfiles: { full: ["true"] },
      commands: { setup: ["true"], cleanup: ["true"] },
    },
    stateRoot,
    repoRoot: stateRoot,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only", allowDomains: [] },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
  });

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-"));
    const worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(worktree, ".phax-context"), { recursive: true });
    await writeFile(join(worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("re-enters the gate loop without invoking the implementation agent when the human's fix made the gate pass", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(singlePhaseRawPlan));
    const config = baseConfig();
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "feedface12345678\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    // Only the post-gate handoff resume should be needed.
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );
    await seedGatesExhaustedRun({
      runPath,
      worktreePath,
      claudeSessionId: "sess-original-abc",
    });

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    // The implementation agent must NOT be invoked on a gate-first resume.
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
    // No fix attempts were needed because the human-applied fix made the gate pass.
    const resumeCallsForFixes = fakeBackend.impl.resumeCalls.filter((c) =>
      c.options.outputJsonlPath?.includes("fix-attempt-"),
    );
    expect(resumeCallsForFixes).toHaveLength(0);

    const phaseStatus = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phaseStatus.state).toBe("review_open");
    // Prior attempt artifacts must not be clobbered by the resume.
    await expect(
      access(join(runPath, "phase-01", "checks-attempt-01.log")),
    ).resolves.toBeUndefined();
  });

  it("pauses the run again (does not fail it) when the gate keeps failing on resume", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(singlePhaseRawPlan));
    const config = baseConfig();
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);

    const fakeShell = makeFakeShell();
    // Gate command keeps failing on the resumed gate loop.
    fakeShell.impl.setResponse("true", { exitCode: 1, stdout: "", stderr: "boom" });

    const fakeBackend = makeFakeBackend();
    // The fresh fix budget = maxFixAttempts = 1 → one fix call before exhaustion.
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-fixed-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );
    await seedGatesExhaustedRun({
      runPath,
      worktreePath,
      claudeSessionId: "sess-original-abc",
    });

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GateAttemptsExhaustedError);
    }
    // No implementation-agent call ever happens on a gate-first resume.
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
    // The resume must re-park the run as `interrupted` with phase
    // `gates_exhausted`, not drive it to terminal `failed`.
    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
      stoppedReason?: string;
    };
    expect(runStatus.state).toBe("interrupted");
    expect(runStatus.stoppedReason).toBe("gates_exhausted");
    const phaseStatus = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phaseStatus.state).toBe("gates_exhausted");
    // The resume started at attempt 2, so the original attempt 01 log is intact
    // and a fresh attempt 02 log was written.
    await expect(
      access(join(runPath, "phase-01", "checks-attempt-02.log")),
    ).resolves.toBeUndefined();
  });

  it("fails loudly with a reset-phase-directing error when the persisted Claude session id is missing", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(singlePhaseRawPlan));
    const config = baseConfig();
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    const fakeShell = makeFakeShell();
    const fakeBackend = makeFakeBackend();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );
    await seedGatesExhaustedRun({
      runPath,
      worktreePath,
      claudeSessionId: undefined,
    });

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(AgentSessionIdMissingError);
      expect((result.left as AgentSessionIdMissingError).message).toContain("phax reset-phase");
    }
    // The implementation agent must not be started blindly when the session is lost.
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
    expect(fakeBackend.impl.resumeCalls).toHaveLength(0);
  });

  it("uses the locked binding provider/model on resume, ignoring routing config", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(singlePhaseRawPlan));
    const config = baseConfig();
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    // Dirty worktree so commitPhase proceeds after the gate passes.
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "feedface12345678\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    // One handoff-generation resume call expected (gate passes immediately).
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );
    await seedGatesExhaustedRun({
      runPath,
      worktreePath,
      claudeSessionId: "sess-original-abc",
    });

    // Seed an agent-binding.json binding the phase to "codex-cli".
    // Default routing would select "claude-code" — the binding must win.
    const phaseFolder = join(runPath, "phase-01");
    const binding = {
      version: 1,
      shortName: "my-run",
      runId: "my-run-2026-06-11",
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "First Phase",
      provider: "codex-cli",
      adapter: "codex",
      model: "codex-mini-latest",
      effort: "low",
      sessionId: "sess-original-abc",
      sessionHandle: null,
      worktreePath,
      cwd: worktreePath,
      launchedAt: new Date().toISOString(),
      status: "running",
    };
    await writeFile(join(phaseFolder, "agent-binding.json"), JSON.stringify(binding, null, 2));

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    // The implementation agent must not run on a gate-first resume.
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
    // The bound provider/model must be used in the gate loop, not routing's "claude-code".
    expect(fakeBackend.impl.resumeCalls.length).toBeGreaterThan(0);
    expect(fakeBackend.impl.resumeCalls[0].options.provider).toBe("codex-cli");
    expect(fakeBackend.impl.resumeCalls[0].options.model).toBe("codex-mini-latest");
  });
});

const autoPublishRawPlan = {
  version: 1,
  run: {
    shortName: "my-run",
    title: "My Run",
    branch: "ai/my-run",
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "Final Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-01-final",
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
  ],
} as const;

function makePublishConfig(enabled: boolean): ResolvedConfig["publish"] {
  return {
    enabled,
    remote: "origin",
    provider: "github",
    pushBranch: true,
    createPullRequest: true,
  };
}

function makePublishBaseConfig(
  stateRootPath: string,
  publish: ResolvedConfig["publish"],
): ResolvedConfig {
  return {
    raw: {
      version: 1,
      project: { name: "test-project", type: "single-package" },
      state: { root: stateRootPath },
      gateProfiles: { full: ["true"] },
      commands: { setup: ["true"], cleanup: ["true"] },
    },
    stateRoot: stateRootPath,
    repoRoot: stateRootPath,
    maxFixAttempts: 1,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,
    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only", allowDomains: [] },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
    publish,
  };
}

function makeFakesForSinglePhase(worktreePath: string) {
  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);
  fakeGit.impl.addExistingRemote("origin");

  const fakeShell = makeFakeShell();
  fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
  fakeShell.impl.setResponse("git rev-parse HEAD", {
    exitCode: 0,
    stdout: "deadbeef12345678\n",
    stderr: "",
  });
  fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

  const fakeBackend = makeFakeBackend();
  fakeBackend.impl.addRunResponse({
    sessionId: "sess-01" as ClaudeSessionId,
    outputPath: "",
    finalText: "",
  });
  fakeBackend.impl.addResumeResponse({
    sessionId: "sess-01-handoff" as ClaudeSessionId,
    outputPath: "",
    finalText: "",
  });

  return { fakeGit, fakeShell, fakeBackend };
}

describe("executePlan — auto-publish after final review", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-publish-test-"));
    const worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(worktree, ".phax-context"), { recursive: true });
    await writeFile(join(worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("publishes PR and writes publication.json when publish.enabled", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(autoPublishRawPlan));
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");
    const config = makePublishBaseConfig(stateRoot, makePublishConfig(true));

    const { fakeGit, fakeShell, fakeBackend } = makeFakesForSinglePhase(worktreePath);
    const fakeGitHub = makeFakeGitHub();
    fakeGitHub.impl.setCreatedPrUrl("https://github.com/owner/repo/pull/42");

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      fakeGitHub.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");

    const publication = JSON.parse(await readFile(join(runPath, "publication.json"), "utf8")) as {
      prStatus: string;
      pullRequestUrl: string;
    };
    expect(publication.prStatus).toBe("created");
    expect(publication.pullRequestUrl).toBe("https://github.com/owner/repo/pull/42");

    const finalReport = await readFile(join(runPath, "final-report.md"), "utf8");
    expect(finalReport).toContain("https://github.com/owner/repo/pull/42");

    const createCall = fakeGitHub.impl.calls.find((c) => c.method === "createPullRequest");
    expect(createCall).toBeDefined();
  });

  it("run stays review_open when gh is unavailable (non-fatal failure)", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(autoPublishRawPlan));
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");
    const config = makePublishBaseConfig(stateRoot, makePublishConfig(true));

    const { fakeGit, fakeShell, fakeBackend } = makeFakesForSinglePhase(worktreePath);
    const fakeGitHub = makeFakeGitHub();
    fakeGitHub.impl.setAvailable(false);

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      fakeGitHub.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    // Run must succeed even though publication failed
    expect(Either.isRight(result)).toBe(true);

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");

    const publication = JSON.parse(await readFile(join(runPath, "publication.json"), "utf8")) as {
      pushStatus: string;
      prStatus: string;
      failureReason: string;
    };
    expect(publication.pushStatus).toBe("not_attempted");
    expect(publication.prStatus).toBe("not_attempted");
    expect(publication.failureReason).toContain("gh");

    const createCall = fakeGitHub.impl.calls.find((c) => c.method === "createPullRequest");
    expect(createCall).toBeUndefined();
  });

  it("no publication side effects when publish.enabled is false", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(autoPublishRawPlan));
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");
    const config = makePublishBaseConfig(stateRoot, makePublishConfig(false));

    const { fakeGit, fakeShell, fakeBackend } = makeFakesForSinglePhase(worktreePath);
    const fakeGitHub = makeFakeGitHub();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      fakeGitHub.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");

    // No publication.json should be written
    await expect(readFile(join(runPath, "publication.json"), "utf8")).rejects.toThrow();

    // No GitHub calls should have been made
    expect(fakeGitHub.impl.calls).toHaveLength(0);
  });
});

describe("executePlan — security preflight", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-preflight-test-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("fails with SecurityPreflightError before any agent runs when required command is missing", async () => {
    const rawPlanWithRequired = {
      version: 1,
      run: {
        shortName: "my-run",
        title: "My Run",
        branch: "ai/my-run",
        requiredCommands: ["deno fmt"],
      },
      phases: [
        {
          id: "phase-01",
          title: "First Phase",
          model: "claude-sonnet-4-6",
          effort: "low" as const,
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: add thing", body: "Adds the thing." },
        },
      ],
    } as const;

    const plan = Either.getOrThrow(decodePhaxPlan(rawPlanWithRequired));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        project: { name: "test-project", type: "single-package" },
        state: { root: stateRoot },
        gateProfiles: { full: ["pnpm test"] },
        commands: { setup: [], cleanup: [] },
      },
      stateRoot,
      repoRoot: stateRoot,
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
      fileReconciliationMode: "report_only" as const,
      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only", allowDomains: [] },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: [],
      },
    };

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    const fakeShell = makeFakeShell();
    const fakeBackend = makeFakeBackend();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SecurityPreflightError);
      const err = result.left as SecurityPreflightError;
      expect(err.missing).toContain("deno fmt");
    }

    // No agent should have been spawned
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
  });

  it("proceeds normally when all required commands are covered by config", async () => {
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(worktreePath, ".phax-context"), { recursive: true });
    await writeFile(
      join(worktreePath, ".phax-context", "phase-handoff.md"),
      [
        "## What was delivered",
        "Done.",
        "## Key decisions and why",
        "None.",
        "## Exact locations (file paths and exported names)",
        "None.",
        "## What the next phase needs to know",
        "Nothing.",
      ].join("\n"),
    );

    const rawPlanWithCoveredRequired = {
      version: 1,
      run: {
        shortName: "my-run",
        title: "My Run",
        branch: "ai/my-run",
        requiredCommands: ["deno fmt"],
      },
      phases: [
        {
          id: "phase-01",
          title: "First Phase",
          model: "claude-sonnet-4-6",
          effort: "low" as const,
          planMarkdownAnchor: "#phase-01",
          plannedFilesToCreate: [],
          plannedFilesToEdit: [],
          optionalFilesToEdit: [],
          commit: { subject: "feat: add thing", body: "Adds the thing." },
        },
      ],
    } as const;

    const plan = Either.getOrThrow(decodePhaxPlan(rawPlanWithCoveredRequired));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        project: { name: "test-project", type: "single-package" },
        state: { root: stateRoot },
        gateProfiles: { full: ["true"] },
        commands: { setup: [], cleanup: [] },
      },
      stateRoot,
      repoRoot: stateRoot,
      maxFixAttempts: 1,
      extractPlanModel: "claude-haiku-4-5-20251001",
      extractPlanEffort: "low" as const,
      fileReconciliationMode: "report_only" as const,
      security: {
        profile: "unsafe",
        filesystem: { allowRead: [], allowWrite: [] },
        network: { profile: "provider-only", allowDomains: [] },
        mcp: { mode: "disabled", allow: [] },
        agentCommands: ["deno fmt"],
      },
    };

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "cafebabe\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      makeFakeGitHub().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    // Agent ran once
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
  });
});
