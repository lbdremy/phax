import { Effect, Either, Layer } from "effect";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
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
      editorCommand: "echo",
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
      editorCommand: "echo",
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
    editorCommand: "echo",
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

    // Simulate that one gate attempt (and one fix) already ran before the
    // budget was exhausted. The resume path must continue numbering past these.
    await writeFile(join(phaseFolder, "checks-attempt-01.log"), "gate failed\n");
    await writeFile(join(phaseFolder, "fix-attempt-01.jsonl"), "");
  }

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
    editorCommand: "echo",
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

describe("executePlan — auto-publish after final review", () => {
  let stateRoot: string;

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
      editorCommand: "echo",
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
      editorCommand: "echo",
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
