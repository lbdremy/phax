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
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createPhaseFolder } from "../../src/app/phaseFolder.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { preparePhaseBranch, type PreparedPhaseBranch } from "../../src/app/worktree.js";
import { decodePhaseId, decodeShortName, decodeBranchName } from "../../src/domain/branded.js";
import type { BranchName, ClaudeSessionId, PhaseId } from "../../src/domain/branded.js";
import { UnsafeGitStateError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NodeGitLayer } from "../../src/infra/git.js";
import type { FileSystem } from "../../src/ports/fs.js";
import type { Git } from "../../src/ports/git.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import {
  currentSchemaUrl,
  readPhaseStatusFile,
  readPhaxPlanFile,
} from "../../src/schemas/persisted.js";

// Made-up full commit shas for the fake git's branch tips.
const RUN_TIP = "1111111111111111111111111111111111111111";
const PHASE_01_TIP = "2222222222222222222222222222222222222222";

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
    fakeGit.impl.setBranchRef("ai/my-run", RUN_TIP);
    const prepared01 = await Effect.runPromise(
      preparePhaseBranch(baseBranch, phase01Id, baseBranch, "/repo").pipe(
        Effect.provide(fakeGit.layer),
      ),
    );
    expect(prepared01).toEqual({ kind: "created", branch: "ai/my-run--phase-01", base: RUN_TIP });

    // Phase-02 branches off phase-01, at phase-01's tip.
    fakeGit.impl.setBranchRef("ai/my-run--phase-01", PHASE_01_TIP);
    const prepared02 = await Effect.runPromise(
      preparePhaseBranch(baseBranch, phase02Id, prepared01.branch, "/repo").pipe(
        Effect.provide(fakeGit.layer),
      ),
    );
    expect(prepared02).toEqual({
      kind: "created",
      branch: "ai/my-run--phase-02",
      base: PHASE_01_TIP,
    });

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
    expect(result).toEqual({ kind: "existing", branch: "ai/my-run--phase-01" });

    const createCalls = fakeGit.impl.calls.filter((c) => c.method === "createBranch");
    expect(createCalls).toHaveLength(0);
  });

  it("notes a deterministic full sha for a source branch the fake has no ref for", async () => {
    const fakeGit = makeFakeGit();
    const baseBranch = Either.getOrThrow(decodeBranchName("ai/my-run"));
    const phase01Id = Either.getOrThrow(decodePhaseId("phase-01"));

    const prepared = await Effect.runPromise(
      preparePhaseBranch(baseBranch, phase01Id, baseBranch, "/repo").pipe(
        Effect.provide(fakeGit.layer),
      ),
    );
    if (prepared.kind !== "created") throw new Error("expected a created branch");
    expect(prepared.base).toMatch(/^[0-9a-f]{40}$/);
  });
});

// ---------------------------------------------------------------------------
// The noted base, against a real git repository
// ---------------------------------------------------------------------------

describe("the noted base — real git", () => {
  let repoDir: string;
  let runPath: string;
  const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan));
  const phase01 = plan.phases[0];
  const phase02 = plan.phases[1]!;
  const runBranch = Either.getOrThrow(decodeBranchName("ai/my-run"));
  const phase01Id = Either.getOrThrow(decodePhaseId("phase-01"));
  const phase02Id = Either.getOrThrow(decodePhaseId("phase-02"));
  const layers = Layer.mergeAll(NodeGitLayer, NodeFileSystemLayer);

  function git(args: string): string {
    return execSync(`git ${args}`, { cwd: repoDir, stdio: "pipe" }).toString().trim();
  }

  function commitOn(branch: string, file: string): string {
    git(`checkout -q ${branch}`);
    writeFileSync(join(repoDir, file), `${file}\n`);
    git(`add ${file}`);
    git(`commit -q -m "chore: ${file}"`);
    git("checkout -q main");
    return git(`rev-parse ${branch}`);
  }

  function prepare(phaseId: PhaseId, from: BranchName) {
    return preparePhaseBranch(runBranch, phaseId, from, repoDir);
  }

  function noteBase(phase: PhaxPlanPhase, index: number, prepared: PreparedPhaseBranch) {
    return createPhaseFolder(runPath, phase, index, prepared, repoDir);
  }

  function readStatus(phaseId: string): PhaseStatus {
    const file = join(runPath, phaseId, "status.json");
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Either.getOrThrow(readPhaseStatusFile(file, raw));
  }

  const run = <A, E>(effect: Effect.Effect<A, E, Git | FileSystem>): Promise<A> =>
    Effect.runPromise(effect.pipe(Effect.provide(layers)));

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), "phax-noted-base-"));
    runPath = await mkdtemp(join(tmpdir(), "phax-noted-base-run-"));
    git("init -q -b main");
    disableGitAutoMaintenance(repoDir);
    git("config --local user.email test@phax.test");
    git("config --local user.name 'phax test'");
    writeFileSync(join(repoDir, "README.md"), "# example\n");
    git("add README.md");
    git('commit -q -m "chore: initial commit"');
    git("branch ai/my-run");
    commitOn("ai/my-run", "run.txt");
  });

  afterEach(async () => {
    removeTempDir(repoDir);
    await rm(runPath, { recursive: true, force: true });
  });

  it("notes the full sha of the source branch's tip when phax creates the branch", async () => {
    const runTip = git("rev-parse ai/my-run");

    const prepared = await run(prepare(phase01Id, runBranch));
    expect(prepared).toEqual({ kind: "created", branch: "ai/my-run--phase-01", base: runTip });

    await run(noteBase(phase01, 0, prepared));
    expect(readStatus("phase-01").base).toBe(runTip);
  });

  it("notes phase-01's tip as phase-02's base", async () => {
    const prepared01 = await run(prepare(phase01Id, runBranch));
    await run(noteBase(phase01, 0, prepared01));
    const phase01Tip = commitOn("ai/my-run--phase-01", "phase-01.txt");

    const prepared02 = await run(prepare(phase02Id, prepared01.branch));
    await run(noteBase(phase02, 1, prepared02));
    expect(readStatus("phase-02").base).toBe(phase01Tip);
  });

  it("keeps the noted base after commits on the phase branch and a moved source branch", async () => {
    const runTip = git("rev-parse ai/my-run");
    const prepared = await run(prepare(phase01Id, runBranch));
    await run(noteBase(phase01, 0, prepared));

    commitOn("ai/my-run--phase-01", "work.txt");
    commitOn("ai/my-run", "moved.txt");

    const again = await run(prepare(phase01Id, runBranch));
    expect(again).toEqual({ kind: "existing", branch: "ai/my-run--phase-01" });
    await run(noteBase(phase01, 0, again));
    expect(readStatus("phase-01").base).toBe(runTip);
  });

  it("notes the new source tip after the branch is deleted and the folder archived", async () => {
    const prepared = await run(prepare(phase01Id, runBranch));
    await run(noteBase(phase01, 0, prepared));

    git("branch -D ai/my-run--phase-01");
    renameSync(join(runPath, "phase-01"), join(runPath, "phase-01.archived"));
    const newTip = commitOn("ai/my-run", "moved.txt");

    const recreated = await run(prepare(phase01Id, runBranch));
    expect(recreated).toEqual({ kind: "created", branch: "ai/my-run--phase-01", base: newTip });
    await run(noteBase(phase01, 0, recreated));
    expect(readStatus("phase-01").base).toBe(newTip);
  });

  it("replaces the noted base, keeping every other fact, when phax re-creates the branch", async () => {
    const prepared = await run(prepare(phase01Id, runBranch));
    await run(noteBase(phase01, 0, prepared));
    const before = readStatus("phase-01");

    git("branch -D ai/my-run--phase-01");
    const newTip = commitOn("ai/my-run", "moved.txt");

    const recreated = await run(prepare(phase01Id, runBranch));
    await run(noteBase(phase01, 0, recreated));
    const after = readStatus("phase-01");
    expect(after.base).toBe(newTip);
    expect({ ...after, base: before.base, updatedAt: before.updatedAt }).toEqual(before);
  });

  it("refuses a phase branch that exists without a phase status, naming the branch", async () => {
    git("branch ai/my-run--phase-01 ai/my-run");

    const prepared = await run(prepare(phase01Id, runBranch));
    expect(prepared.kind).toBe("existing");
    const result = await run(Effect.either(noteBase(phase01, 0, prepared)));

    if (Either.isRight(result)) throw new Error("expected a refusal");
    expect(result.left).toBeInstanceOf(UnsafeGitStateError);
    expect(result.left.message).toContain('"ai/my-run--phase-01"');
    expect(result.left.message).toContain("git branch -D ai/my-run--phase-01");
    expect(existsSync(join(runPath, "phase-01", "status.json"))).toBe(false);
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
    const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        name: "test-project",
        state: { root: stateRoot },
        gateProfiles: {
          full: [{ command: "true", surface: "local", firing: "every-phase", output: "log" }],
        },
        commands: { setup: ["true"], cleanup: ["true"] },
      },
      stateRoot,
      namespace: "test-project",
      repoRoot: stateRoot,
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

    const phase01WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    const phase02WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-02");

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
      makeFakeGitHub().layer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
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
    const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan));

    const config: ResolvedConfig = {
      raw: {
        version: 1,
        name: "test-project",
        state: { root: stateRoot },
        gateProfiles: {
          full: [{ command: "true", surface: "local", firing: "every-phase", output: "log" }],
        },
        commands: { setup: ["true"] },
      },
      stateRoot,
      namespace: "test-project",
      repoRoot: stateRoot,
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
        $schema: currentSchemaUrl("phase-status"),
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "committed",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: "ai/my-run--phase-01",
        base: RUN_TIP,
        createdAt: now,
        updatedAt: now,
        worktreePath: join(stateRoot, "worktrees", "test-project.my-run", "phase-01"),
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
      join(phase01FolderPath, "file-reconciliation.md"),
      "## File Reconciliation\n\nNo deviations.",
    );
    await writeFile(join(phase01FolderPath, "phase-handoff.md"), HANDOFF_CONTENT);
    await writeFile(
      join(runPath, "run-status.json"),
      JSON.stringify({
        version: 1,
        namespace: "test-project",
        shortName: "my-run",
        runId,
        state: "running",
        createdAt: now,
        updatedAt: now,
        phasesCount: 2,
        gateProfileId: "full",
      }),
    );

    const phase02WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-02");

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
      makeFakeGitHub().layer,
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
