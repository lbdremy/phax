/**
 * Regression test for per-phase branch chaining.
 *
 * Before the fix, every phase received the run-level branch (`plan.run.branch`),
 * so `git worktree add` failed on phase-02 with "already checked out".
 *
 * After the fix each phase gets its own branch (`<run.branch>--<phaseId>`),
 * chained off the prior phase's branch, so all worktrees can coexist.
 */

import { Effect, Either, Layer } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { preparePhaseBranch } from "../../src/app/worktree.js";
import { decodePhaseId, decodeShortName, decodeBranchName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
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

// ---------------------------------------------------------------------------
// Unit tests for preparePhaseBranch
// ---------------------------------------------------------------------------

describe("preparePhaseBranch — unit", () => {
  it("builds the correct branch name and calls createBranch with the right from-ref", async () => {
    const fakeGit = makeFakeGit();
    const baseBranch = Either.getOrThrow(decodeBranchName("ai/my-run"));
    const phase01Id = Either.getOrThrow(decodePhaseId("phase-01"));
    const phase02Id = Either.getOrThrow(decodePhaseId("phase-02"));

    // Phase-01 branches off the run branch.
    const branch01 = await Effect.runPromise(
      preparePhaseBranch(baseBranch, phase01Id, baseBranch, "/repo").pipe(
        Effect.provide(fakeGit.layer),
      ),
    );
    expect(branch01).toBe("ai/my-run--phase-01");

    // Phase-02 branches off phase-01.
    const branch02 = await Effect.runPromise(
      preparePhaseBranch(baseBranch, phase02Id, branch01, "/repo").pipe(
        Effect.provide(fakeGit.layer),
      ),
    );
    expect(branch02).toBe("ai/my-run--phase-02");

    const createCalls = fakeGit.impl.calls.filter((c) => c.method === "createBranch");
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]).toMatchObject({
      branch: "ai/my-run--phase-01",
      from: "ai/my-run",
    });
    expect(createCalls[1]).toMatchObject({
      branch: "ai/my-run--phase-02",
      from: "ai/my-run--phase-01",
    });
  });

  it("skips createBranch when the phase branch already exists", async () => {
    const fakeGit = makeFakeGit();
    fakeGit.impl.addExistingBranch("ai/my-run--phase-01");

    const baseBranch = Either.getOrThrow(decodeBranchName("ai/my-run"));
    const phase01Id = Either.getOrThrow(decodePhaseId("phase-01"));

    const result = await Effect.runPromise(
      preparePhaseBranch(baseBranch, phase01Id, baseBranch, "/repo").pipe(
        Effect.provide(fakeGit.layer),
      ),
    );
    expect(result).toBe("ai/my-run--phase-01");

    const createCalls = fakeGit.impl.calls.filter((c) => c.method === "createBranch");
    expect(createCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regression test: two-phase executePlan with no pre-created worktrees
// ---------------------------------------------------------------------------

describe("executePlan — per-phase branch regression", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-branch-regression-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("creates two addWorktree calls with distinct branches and correct createBranch chain", async () => {
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
    // The fake backend will write the handoff file into the worktree so that
    // generatePhaseHandoff can validate it — without needing pre-created dirs.
    fakeBackend.impl.setAutoHandoffContent(HANDOFF_CONTENT);
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

    expect(
      Either.isRight(result),
      Either.isLeft(result) ? `executePlan failed: ${String(result.left)}` : "",
    ).toBe(true);

    // (a) Exactly two addWorktree calls — one per phase, since no pre-created dirs.
    const addWorktreeCalls = fakeGit.impl.calls.filter((c) => c.method === "addWorktree");
    expect(addWorktreeCalls).toHaveLength(2);

    const worktreeBranches = addWorktreeCalls.map(
      (c) => (c as { method: "addWorktree"; branch: string }).branch,
    );
    expect(worktreeBranches[0]).toBe("ai/my-run--phase-01");
    expect(worktreeBranches[1]).toBe("ai/my-run--phase-02");

    // (b) createBranch chain: run-branch → phase-01, phase-01 → phase-02.
    const createBranchCalls = fakeGit.impl.calls.filter(
      (c) => c.method === "createBranch",
    ) as Array<{
      method: "createBranch";
      branch: string;
      from: string;
    }>;
    // One from prepareRunBranch + one per phase
    const phaseBranchCalls = createBranchCalls.filter((c) => c.branch.includes("--phase-"));
    expect(phaseBranchCalls).toHaveLength(2);
    expect(phaseBranchCalls[0]).toMatchObject({
      branch: "ai/my-run--phase-01",
      from: "ai/my-run",
    });
    expect(phaseBranchCalls[1]).toMatchObject({
      branch: "ai/my-run--phase-02",
      from: "ai/my-run--phase-01",
    });

    // (c) The two addWorktree calls used distinct branches — no collision.
    // (The fake git's conflict detection would have caused executePlan to fail
    // if the same branch was checked out twice.)
    expect(worktreeBranches[0]).not.toBe(worktreeBranches[1]);
  });

  it("seeds previousPhaseBranch correctly on resume: createBranch only for phase-02", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        project: { name: "test-project", type: "single-package" },
        state: { root: stateRoot },
        gateProfiles: { full: ["true"] },
        commands: { setup: ["true"] },
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

    // Bootstrap run folder
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

    // Simulate phase-01 already committed
    const { writeFile, mkdir } = await import("node:fs/promises");
    const now = new Date().toISOString();
    const phase01FolderPath = join(runPath, "phase-01");
    await mkdir(phase01FolderPath, { recursive: true });
    await writeFile(
      join(phase01FolderPath, "status.json"),
      JSON.stringify({
        version: 1,
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "committed",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: "ai/my-run--phase-01",
        createdAt: now,
        updatedAt: now,
        worktreePath: join(stateRoot, "worktrees", "my-run", "phase-01"),
        commitHash: "aabbccdd",
      }),
    );
    await writeFile(
      join(phase01FolderPath, "file-reconciliation.json"),
      JSON.stringify({
        phaseId: "phase-01",
        createdAsPlanned: [],
        editedAsPlanned: [],
        missingPlannedCreate: [],
        missingPlannedEdit: [],
        unplannedCreated: [],
        unplannedEdited: [],
        optionalTouched: [],
        deletions: [],
        renames: [],
        hasDeviations: false,
      }),
    );
    await writeFile(
      join(phase01FolderPath, "file-reconciliation.md"),
      "## File Reconciliation\n\nNo deviations.",
    );
    await writeFile(join(phase01FolderPath, "phase-handoff.md"), HANDOFF_CONTENT);
    await writeFile(
      join(runPath, "run-status.json"),
      JSON.stringify({
        version: 1,
        shortName: "my-run",
        runId,
        state: "running",
        createdAt: now,
        updatedAt: now,
        phasesCount: 2,
        gateProfileId: "full",
      }),
    );

    const phase02WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-02");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(false); // would fail prepareRunBranch if called
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

    const resumeLayers = Layer.mergeAll(
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
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: true,
          runPath,
          runId,
          startIndex: 1,
        }).pipe(Effect.provide(resumeLayers)),
      ),
    );

    expect(
      Either.isRight(result),
      Either.isLeft(result) ? `executePlan resume failed: ${String(result.left)}` : "",
    ).toBe(true);

    // On resume from startIndex=1, prepareRunBranch is NOT called (isClean not checked).
    const isCleanCalls = fakeGit.impl.calls.filter((c) => c.method === "isClean");
    expect(isCleanCalls).toHaveLength(0);

    // createBranch only for phase-02, branching off phase-01.
    const createBranchCalls = fakeGit.impl.calls.filter(
      (c) => c.method === "createBranch",
    ) as Array<{
      method: "createBranch";
      branch: string;
      from: string;
    }>;
    const phaseBranchCalls = createBranchCalls.filter((c) => c.branch.includes("--phase-"));
    expect(phaseBranchCalls).toHaveLength(1);
    expect(phaseBranchCalls[0]).toMatchObject({
      branch: "ai/my-run--phase-02",
      from: "ai/my-run--phase-01",
    });
  });
});
