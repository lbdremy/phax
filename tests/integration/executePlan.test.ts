import { Effect, Either, Layer } from "effect";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { AgentSessionIdMissingError, GateAttemptsExhaustedError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
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

const singlePhaseRawPlan = {
  version: 1,
  run: {
    shortName: "my-run",
    title: "My Run",
    branch: "ai/my-run",
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

function makeConfig(stateRoot: string, maxFixAttempts = 1): ResolvedConfig {
  return {
    raw: {
      version: 1,
      project: { name: "test-project", type: "single-package" },
      state: { root: stateRoot },
      gateProfiles: { full: ["pnpm test"] },
      commands: { setup: ["true"], cleanup: ["true"] },
    },
    stateRoot,
    repoRoot: stateRoot,
    editorCommand: "echo",
    maxFixAttempts,
    extractPlanModel: "claude-haiku-4-5-20251001",
    extractPlanEffort: "low" as const,
    fileReconciliationMode: "report_only" as const,

    security: {
      profile: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only", allowDomains: [] },
      mcp: { mode: "disabled", allow: [] },
    },
  };
}

async function seedGatesExhaustedPhase(opts: {
  runPath: string;
  worktreePath: string;
  claudeSessionId?: string | undefined;
  latestAttempt?: number | undefined;
}) {
  const now = "2026-06-10T00:00:00.000Z";
  const phaseFolderPath = join(opts.runPath, "phase-01");
  await mkdir(phaseFolderPath, { recursive: true });
  await mkdir(join(opts.worktreePath, ".phax-context"), { recursive: true });

  const rawRunStatus = JSON.parse(
    await readFile(join(opts.runPath, "run-status.json"), "utf8"),
  ) as Record<string, unknown>;
  await writeFile(
    join(opts.runPath, "run-status.json"),
    JSON.stringify(
      {
        ...rawRunStatus,
        state: "interrupted",
        currentPhaseIndex: 0,
        gateProfileId: "full",
        stoppedReason: "gates_exhausted",
        lastError: "Gate failed: pnpm test",
        updatedAt: now,
      },
      null,
      2,
    ),
  );

  await writeFile(
    join(phaseFolderPath, "status.json"),
    JSON.stringify(
      {
        version: 1,
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "gates_exhausted",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: "ai/my-run--phase-01",
        worktreePath: opts.worktreePath,
        ...(opts.claudeSessionId !== undefined ? { claudeSessionId: opts.claudeSessionId } : {}),
        createdAt: now,
        updatedAt: now,
      },
      null,
      2,
    ),
  );

  const latestAttempt = opts.latestAttempt ?? 3;
  await writeFile(
    join(phaseFolderPath, `checks-attempt-${String(latestAttempt).padStart(2, "0")}.log`),
    "previous failed gate log",
  );

  return { phaseFolderPath };
}

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
    ) as { state: string; worktreePath?: string; commitHash?: string; claudeSessionId?: string };
    expect(phase01Status.state).toBe("cleaned_up");
    expect(phase01Status.worktreePath).toBe(phase01WorktreePath);
    expect(phase01Status.claudeSessionId).toBe("sess-01");
    expect(phase01Status.commitHash).toBe("deadbeef12345678");

    const phase02Status = JSON.parse(
      await readFile(join(runPath, "phase-02", "status.json"), "utf8"),
    ) as { state: string; claudeSessionId?: string };
    expect(phase02Status.state).toBe("review_open");
    expect(phase02Status.claudeSessionId).toBe("sess-02");

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

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("re-runs gates first and commits without invoking a fresh implementation agent", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(singlePhaseRawPlan));
    const config = makeConfig(stateRoot);
    const phaseWorktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.enqueueWorktreeIsClean(phaseWorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("pnpm test", { exitCode: 0, stdout: "ok\n", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "feedface\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.setAutoHandoffContent(HANDOFF_CONTENT);
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-existing-handoff" as ClaudeSessionId,
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
    const { phaseFolderPath } = await seedGatesExhaustedPhase({
      runPath,
      worktreePath: phaseWorktreePath,
      claudeSessionId: "sess-existing",
      latestAttempt: 3,
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
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
    expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
    expect(fakeBackend.impl.resumeCalls[0]?.sessionId).toBe("sess-existing");
    expect(fakeGit.impl.calls.some((call) => call.method === "addWorktree")).toBe(false);
    expect(await readFile(join(phaseFolderPath, "checks-attempt-03.log"), "utf8")).toBe(
      "previous failed gate log",
    );
    expect(await readFile(join(phaseFolderPath, "checks-attempt-04.log"), "utf8")).toContain(
      "exit 0",
    );
    const commitCall = fakeGit.impl.calls.find((call) => call.method === "commit");
    expect(commitCall?.method === "commit" ? commitCall.body : "").toContain(
      "checks-attempt-04.log",
    );

    const phaseStatus = JSON.parse(
      await readFile(join(phaseFolderPath, "status.json"), "utf8"),
    ) as { state: string; commitHash?: string };
    expect(phaseStatus.state).toBe("review_open");
    expect(phaseStatus.commitHash).toBe("feedface");
  });

  it("keeps the run interrupted and resumable when resumed gates re-exhaust", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(singlePhaseRawPlan));
    const config = makeConfig(stateRoot, 1);
    const phaseWorktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("pnpm test", {
      exitCode: 1,
      stdout: "",
      stderr: "still failing\n",
    });

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-after-fix" as ClaudeSessionId,
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
    const { phaseFolderPath } = await seedGatesExhaustedPhase({
      runPath,
      worktreePath: phaseWorktreePath,
      claudeSessionId: "sess-existing",
      latestAttempt: 3,
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
      expect(result.left.attempt).toBe(5);
    }
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
    expect(fakeBackend.impl.resumeCalls).toHaveLength(1);

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
      stoppedReason?: string;
    };
    expect(runStatus.state).toBe("interrupted");
    expect(runStatus.stoppedReason).toBe("gates_exhausted");

    const phaseStatus = JSON.parse(
      await readFile(join(phaseFolderPath, "status.json"), "utf8"),
    ) as { state: string };
    expect(phaseStatus.state).toBe("gates_exhausted");
  });

  it("fails loudly toward reset-phase when the persisted session id is missing", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(singlePhaseRawPlan));
    const config = makeConfig(stateRoot);
    const phaseWorktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("pnpm test", { exitCode: 0, stdout: "ok\n", stderr: "" });
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
    await seedGatesExhaustedPhase({
      runPath,
      worktreePath: phaseWorktreePath,
      latestAttempt: 3,
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
      expect(result.left.message).toContain("phax reset-phase my-run");
    }
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
    expect(fakeBackend.impl.resumeCalls).toHaveLength(0);
  });
});
