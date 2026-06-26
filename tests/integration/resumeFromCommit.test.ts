import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { PhaseHadNoChangesError } from "../../src/domain/errors.js";
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

/** Seed a run in `interrupted` with phase-01 paused in `passed` (commit failed). */
async function seedCommitFailedRun(opts: {
  runPath: string;
  runId: string;
  phase01WorktreePath: string;
  claudeSessionId: string;
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
      stoppedReason: "commit_failed",
      lastError: "pre-commit hook rejected: unformatted JSON",
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
      state: "passed",
      model: "claude-sonnet-4-6",
      effort: "low",
      createdAt: now,
      updatedAt: now,
      branchName: "ai/my-run--phase-01",
      worktreePath: opts.phase01WorktreePath,
      claudeSessionId: opts.claudeSessionId,
      // no commitHash — the commit failed before it could be recorded
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
}

describe("executePlan — resume from commit-paused (passed+interrupted)", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("re-runs commit → handoff → cleanup for a passed phase, no agent re-run and no gate re-run", async () => {
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

    await seedCommitFailedRun({
      runPath,
      runId,
      phase01WorktreePath,
      claudeSessionId: "sess-01-original",
    });

    // Create phase-01 worktree directory (fake git doesn't create directories).
    await mkdir(join(phase01WorktreePath, ".phax-context"), { recursive: true });
    // Pre-create phase-02 worktree for the same reason.
    await mkdir(join(phase02WorktreePath, ".phax-context"), { recursive: true });

    const fakeGit = makeFakeGit();
    // Phase-01 resume: worktree is dirty (staged changes from original agent run).
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false);
    // Phase-01 cleanup: worktree must be clean after commit.
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, true);
    // Phase-02: dirty so commitPhase actually commits.
    fakeGit.impl.enqueueWorktreeIsClean(phase02WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef01020304\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    // Agent body must NOT be re-run for phase-01.
    // Handoff calls: (1) phase-01 handoff, (2) phase-02 handoff.
    // runAgent calls: (1) phase-02 body only.
    fakeBackend.impl.setAutoHandoffContent(HANDOFF_CONTENT);
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
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

    expect(Either.isRight(result)).toBe(true);

    // Phase-01 agent body must NOT be re-invoked — only phase-02 body runs.
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
    expect(fakeBackend.impl.runCalls[0]?.options.phaseFolderPath).toContain("phase-02");

    // Phase-01 handoff + phase-02 handoff = 2 resume calls total.
    expect(fakeBackend.impl.resumeCalls).toHaveLength(2);

    // Two git commit calls: one for phase-01 (the re-run) and one for phase-02.
    const commitCalls = fakeGit.impl.calls.filter((c) => c.method === "commit");
    expect(commitCalls).toHaveLength(2);
    expect(commitCalls[0]?.repo).toContain("phase-01");
    expect(commitCalls[1]?.repo).toContain("phase-02");

    // Run ends in review_open (phase-02 is the final phase).
    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");

    // Phase-01 handoff file written to run folder.
    const phase01Handoff = await readFile(join(runPath, "phase-01", "phase-handoff.md"), "utf8");
    expect(phase01Handoff).toContain("## What was delivered");

    // Phase-01 committed (has a commitHash now).
    const phase01Status = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string; commitHash?: string };
    expect(["committed", "cleaned_up"]).toContain(phase01Status.state);
    expect(phase01Status.commitHash).toBe("deadbeef01020304");

    // Phase-02 ended in review_open.
    const phase02Status = JSON.parse(
      await readFile(join(runPath, "phase-02", "status.json"), "utf8"),
    ) as { state: string; commitHash?: string };
    expect(phase02Status.state).toBe("review_open");
  });

  it("pauses as no-changes (skipped) when the user committed by hand before resuming", async () => {
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

    await seedCommitFailedRun({
      runPath,
      runId,
      phase01WorktreePath,
      claudeSessionId: "sess-01-original",
    });

    await mkdir(join(phase01WorktreePath, ".phax-context"), { recursive: true });

    const fakeGit = makeFakeGit();
    // User committed by hand: worktree is now clean.
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, true);

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

    // The run pauses again — PhaseHadNoChangesError is the clean-pause sentinel.
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(PhaseHadNoChangesError);
    }

    // Run remains interrupted (not failed) so it can be resumed again.
    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("interrupted");

    // Phase-01 is now skipped (treated as no-changes).
    const phase01Status = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phase01Status.state).toBe("skipped");
  });
});
