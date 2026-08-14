import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
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

const PLAN_REL = "docs/plans/70-run-carry-plan.md";
const PLAN_ARCHIVE = "docs/plans/archive/70-run-carry-plan.md";

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
      title: "Only Phase",
      model: "claude-sonnet-4-6",
      effort: "low" as const,
      planMarkdownAnchor: "#phase-01-only",
      plannedFilesToCreate: [] as const,
      plannedFilesToEdit: [] as const,
      optionalFilesToEdit: [] as const,
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
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
      commands: { setup: ["true"], cleanup: ["true"] },
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

function planMd(status: string): string {
  return `---\nstatus: ${status}\nsource-spec: null\n---\n# Some plan\n\n## Overview\n\nBody.\n`;
}

/** Seed a run in `interrupted` with its single final phase paused `committed`
 * (artifact completion failed). */
async function seedCompletionFailedRun(opts: {
  runPath: string;
  runId: string;
  worktreePath: string;
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
      phasesCount: 1,
      currentPhaseIndex: 0,
      gateProfileId: "full",
      stoppedReason: "artifact_completion_failed",
      lastError: "Invalid plan status transition: Draft → Completed",
      planRepoRelPath: PLAN_REL,
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
      state: "committed",
      model: "claude-sonnet-4-6",
      effort: "low",
      createdAt: now,
      updatedAt: now,
      branchName: "ai/my-run--phase-01",
      worktreePath: opts.worktreePath,
      claudeSessionId: opts.claudeSessionId,
      commitHash: "abc123deadbeef",
    }),
  );
  await writeFile(
    join(phaseFolder, "agent-binding.json"),
    JSON.stringify({
      version: 1,
      shortName: "my-run",
      runId: opts.runId,
      phaseId: "phase-01",
      phaseIndex: 0,
      phaseName: "Only Phase",
      provider: "claude-code",
      adapter: "claude",
      model: "claude-sonnet-4-6",
      effort: "low",
      sessionId: opts.claudeSessionId,
      sessionHandle: null,
      worktreePath: opts.worktreePath,
      cwd: opts.worktreePath,
      launchedAt: now,
      status: "running",
    }),
  );
  await writeFile(join(phaseFolder, "phase-handoff.md"), HANDOFF_CONTENT);

  // A genuinely-committed phase has its reconciliation on disk (written after the
  // commit, before completion); the final report reads it when review opens.
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

async function runResume(opts: {
  stateRoot: string;
  layers: Layer.Layer<never, never, never>;
  runPath: string;
  runId: string;
}) {
  const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
  const config = makeConfig(opts.stateRoot);
  return Effect.runPromise(
    Effect.either(
      executePlan({
        shortName,
        namespace: "test-project",
        plan,
        planMd: "# My Plan",
        config,
        gateProfileId: "full",
        allowDirty: true,
        runPath: opts.runPath,
        runId: opts.runId,
        startIndex: 0,
        planRepoRelPath: PLAN_REL,
      }).pipe(Effect.provide(opts.layers as never)),
    ),
  );
}

describe("executePlan — resume from completion-paused (committed final phase)", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-resume-completion-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("re-enters at the completion step, spawning no agent and re-running no gate", async () => {
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
      createRunFolder(shortName, "# My Plan", plan, config, PLAN_REL).pipe(
        Effect.provide(setupLayers),
      ),
    );

    const worktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    await seedCompletionFailedRun({
      runPath,
      runId,
      worktreePath,
      claudeSessionId: "sess-01-original",
    });
    // The operator fixed the frontmatter: the plan now reads Approved on the branch.
    await mkdir(join(worktreePath, "docs", "plans"), { recursive: true });
    await writeFile(join(worktreePath, PLAN_REL), planMd("Approved"));

    const fakeGit = makeFakeGit();
    // Completion transitionArtifact: clean pre-write, dirty post-write → commits.
    fakeGit.impl.enqueueDirtyPaths([]);
    fakeGit.impl.enqueueDirtyPaths([PLAN_REL]);

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

    const result = await runResume({ stateRoot, layers, runPath, runId });

    if (Either.isLeft(result)) console.error("FAILED:", result.left);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    // No agent invocation and no handoff resume on a completion re-entry.
    expect(fakeBackend.impl.runCalls).toHaveLength(0);
    expect(fakeBackend.impl.resumeCalls).toHaveLength(0);
    // The gate command is not re-run.
    const gateCalls = fakeShell.impl.calls.filter((c) => c.command === "true");
    expect(gateCalls).toHaveLength(0);

    // The plan is completed on the branch and reported.
    const planTransition = result.right.artifactCompletions?.transitions.find(
      (t) => t.kind === "plan",
    );
    expect(planTransition).toMatchObject({
      kind: "plan",
      path: PLAN_ARCHIVE,
      alreadyComplete: false,
    });
    expect(await readFile(join(worktreePath, PLAN_ARCHIVE), "utf8")).toContain("status: Completed");

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");
  });

  it("creates no second commit when the plan on the branch is already Completed", async () => {
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
      createRunFolder(shortName, "# My Plan", plan, config, PLAN_REL).pipe(
        Effect.provide(setupLayers),
      ),
    );

    const worktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    await seedCompletionFailedRun({
      runPath,
      runId,
      worktreePath,
      claudeSessionId: "sess-01-original",
    });
    // The prior attempt already moved the plan to archive/ as Completed.
    await mkdir(join(worktreePath, "docs", "plans", "archive"), { recursive: true });
    await writeFile(join(worktreePath, PLAN_ARCHIVE), planMd("Completed"));

    const fakeGit = makeFakeGit();
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

    const result = await runResume({ stateRoot, layers, runPath, runId });

    if (Either.isLeft(result)) console.error("FAILED:", result.left);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    // No commit is created on the idempotent re-entry.
    const commitCalls = fakeGit.impl.calls.filter((c) => c.method === "commitPaths");
    expect(commitCalls).toHaveLength(0);
    // The plan is reported as already complete.
    expect(result.right.artifactCompletions?.transitions).toEqual([
      { kind: "plan", path: PLAN_ARCHIVE, alreadyComplete: true },
    ]);

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");
  });
});
