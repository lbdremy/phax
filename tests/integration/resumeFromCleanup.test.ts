import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { CleanupPausedError } from "../../src/domain/errors.js";
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
    requiredCommands: [],
  },
  phases: [
    {
      id: "phase-01",
      title: "First Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-01-first",
      plannedFilesToCreate: [] as const,
      plannedFilesToEdit: [] as const,
      optionalFilesToEdit: [] as const,
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
    {
      id: "phase-02",
      title: "Second Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-02-second",
      plannedFilesToCreate: [] as const,
      plannedFilesToEdit: [] as const,
      optionalFilesToEdit: [] as const,
      commit: { subject: "ai(phase-02): do more", body: "Does more." },
    },
  ],
} as const;

function makeConfig(stateRoot: string): ResolvedConfig {
  return {
    raw: {
      version: 1,
      project: { name: "test-project", type: "single-package" },
      state: { root: stateRoot },
      gateProfiles: { full: ["true"] },
      commands: { setup: ["true"] },
    },
    stateRoot,
    namespace: "test-project",
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
}

/** Seed a run in `interrupted` with phase-01 paused in `cleaning_up` (cleanup failed). */
async function seedCleanupFailedRun(opts: {
  runPath: string;
  runId: string;
  phase01WorktreePath: string;
  claudeSessionId: string;
  commitHash: string;
}): Promise<void> {
  const now = new Date().toISOString();

  await writeFile(
    join(opts.runPath, "run-status.json"),
    JSON.stringify({
      version: 1,
      namespace: "test-project",
      shortName: "my-run",
      runId: opts.runId,
      state: "interrupted",
      createdAt: now,
      updatedAt: now,
      phasesCount: 2,
      currentPhaseIndex: 0,
      gateProfileId: "full",
      stoppedReason: "cleanup_failed",
      lastError: "git worktree remove exited 1: worktree is dirty",
    }),
  );

  const phaseFolder = join(opts.runPath, "phase-01");
  await mkdir(phaseFolder, { recursive: true });

  await writeFile(
    join(phaseFolder, "status.json"),
    JSON.stringify({
      version: 1,
      phaseId: "phase-01",
      phaseIndex: 0,
      state: "cleaning_up",
      model: "claude-sonnet-4-6",
      effort: "low",
      createdAt: now,
      updatedAt: now,
      branchName: "ai/my-run--phase-01",
      worktreePath: opts.phase01WorktreePath,
      claudeSessionId: opts.claudeSessionId,
      commitHash: opts.commitHash,
    }),
  );

  // Agent-binding.json must exist so the resume path can read the locked
  // provider/model/effort without re-routing.
  await writeFile(
    join(phaseFolder, "agent-binding.json"),
    JSON.stringify({
      version: 1,
      shortName: "my-run",
      runId: opts.runId,
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "First Phase",
      provider: "claude-code",
      adapter: "claude",
      model: "claude-sonnet-4-6",
      effort: "low",
      sessionId: opts.claudeSessionId,
      sessionHandle: null,
      worktreePath: opts.phase01WorktreePath,
      cwd: opts.phase01WorktreePath,
      launchedAt: now,
      status: "running",
    }),
  );

  // phase-handoff.md must exist since we're skipping handoff generation on resume.
  await writeFile(join(phaseFolder, "phase-handoff.md"), HANDOFF_CONTENT);

  // file-reconciliation.json and .md were written after the original commit (before cleanup failed).
  await writeFile(
    join(phaseFolder, "file-reconciliation.json"),
    JSON.stringify({
      phaseId: "phase-01",
      createdAsPlanned: [],
      editedAsPlanned: [],
      missingPlannedCreate: [],
      missingPlannedEdit: [],
      createdButPlannedEdit: [],
      editedButPlannedCreate: [],
      unplannedCreated: [],
      unplannedEdited: [],
      optionalTouched: [],
      deletions: [],
      renames: [],
      hasDeviations: false,
    }),
  );
  await writeFile(
    join(phaseFolder, "file-reconciliation.md"),
    "# File reconciliation\n\nNo deviations.\n",
  );
}

describe("executePlan — resume from cleanup-paused (cleaning_up+interrupted)", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("re-runs only cleanup for a cleaning_up phase, skipping agent/gate/commit/handoff", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);

    const setupLayers = Layer.mergeAll(
      makeFakeGit().layer,
      makeFakeShell().layer,
      makeFakeBackend().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(setupLayers)),
    );

    const phase01WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    const phase02WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-02");

    await seedCleanupFailedRun({
      runPath,
      runId,
      phase01WorktreePath,
      claudeSessionId: "sess-01-original",
      commitHash: "abc123deadbeef",
    });

    // Create phase-01 worktree directory (fake git doesn't create directories).
    await mkdir(join(phase01WorktreePath, ".phax-context"), { recursive: true });
    // Pre-create phase-02 worktree for cleanup step.
    await mkdir(join(phase02WorktreePath, ".phax-context"), { recursive: true });

    const fakeGit = makeFakeGit();
    // Phase-01 cleanup resume: worktree is clean (commit already happened).
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, true);
    // Phase-02: dirty so commitPhase actually commits.
    fakeGit.impl.enqueueWorktreeIsClean(phase02WorktreePath, false);
    // Phase-02 cleanup: worktree is clean after commit.
    fakeGit.impl.enqueueWorktreeIsClean(phase02WorktreePath, true);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef01020304\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    // Phase-01 agent body must NOT be re-run.
    // Phase-01 handoff must NOT be re-run (phase-handoff.md already on disk).
    // Phase-02 body: 1 run call.
    // Phase-02 handoff: 1 resume call.
    fakeBackend.impl.setAutoHandoffContent(HANDOFF_CONTENT);
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-02" as ClaudeSessionId,
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

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: true,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    if (Either.isLeft(result)) console.error("FAILED:", result.left);
    expect(Either.isRight(result)).toBe(true);

    // Phase-01 agent body must NOT be re-invoked — only phase-02 body runs.
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
    expect(fakeBackend.impl.runCalls[0]?.options.phaseFolderPath).toContain("phase-02");

    // Only phase-02 handoff runs (1 resume call).
    expect(fakeBackend.impl.resumeCalls).toHaveLength(1);
    expect(fakeBackend.impl.resumeCalls[0]?.options.phaseFolderPath).toContain("phase-02");

    // No git commit for phase-01 (commit already happened); only phase-02 commits.
    const commitCalls = fakeGit.impl.calls.filter((c) => c.method === "commit");
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]?.repo).toContain("phase-02");

    // Run ends in review_open (phase-02 is the final phase).
    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");

    // Phase-01 status advances to cleaned_up.
    const phase01Status = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string; commitHash?: string };
    expect(phase01Status.state).toBe("cleaned_up");
    // commitHash preserved from original run.
    expect(phase01Status.commitHash).toBe("abc123deadbeef");
  });

  it("pauses as CleanupPausedError when cleanup fails again on resume", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);

    const setupLayers = Layer.mergeAll(
      makeFakeGit().layer,
      makeFakeShell().layer,
      makeFakeBackend().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(setupLayers)),
    );

    const phase01WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");

    await seedCleanupFailedRun({
      runPath,
      runId,
      phase01WorktreePath,
      claudeSessionId: "sess-01-original",
      commitHash: "abc123deadbeef",
    });

    await mkdir(join(phase01WorktreePath, ".phax-context"), { recursive: true });

    const fakeGit = makeFakeGit();
    // Worktree is still dirty: cleanup will fail again with ArchiveBlockedByDirtyWorktreeError.
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: true,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    // The run pauses again — CleanupPausedError is the pause sentinel.
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(CleanupPausedError);
    }

    // Run remains interrupted (not failed) so it can be resumed again.
    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
      stoppedReason?: string;
    };
    expect(runStatus.state).toBe("interrupted");
    expect(runStatus.stoppedReason).toBe("cleanup_failed");

    // Phase-01 is in cleaning_up.
    const phase01Status = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phase01Status.state).toBe("cleaning_up");
  });
});
