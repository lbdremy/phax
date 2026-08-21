import { Effect, Either, Layer } from "effect";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { ArtifactCompletionPausedError } from "../../src/domain/errors.js";
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
const SPEC_REL = "docs/specs/70-run-carry.md";
const SPEC_ARCHIVE = "docs/specs/archive/70-run-carry.md";

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
      gateProfiles: { full: [{ command: "true", surface: "local", firing: "every-phase" }] },
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
      network: { profile: "provider-only", allowDomains: [] },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
  };
}

function planMd(status: string, sourceSpec: string): string {
  return `---\nstatus: ${status}\nsource-spec: ${sourceSpec}\n---\n# Some plan\n\n## Overview\n\nBody.\n`;
}

function specMd(status: string): string {
  return `---\nstatus: ${status}\ndate: 2026-01-01\naudience: test\nscope: test\n---\n# Some spec\n\n## Overview\n\nBody.\n`;
}

function approvalsJson(): string {
  return JSON.stringify(
    {
      version: 1,
      records: {
        [PLAN_REL]: {
          planFingerprint: "planfp",
          approvedAt: "2026-08-14T00:00:00.000Z",
          baseline: "a".repeat(40),
          sourceSpec: { path: SPEC_REL, fingerprint: "specfp" },
        },
      },
    },
    null,
    2,
  );
}

/** Lay out the lifecycle artifacts inside the final phase's worktree. */
async function seedWorktreeArtifacts(worktreePath: string, planStatus: string, sourceSpec: string) {
  await mkdir(join(worktreePath, ".phax-context"), { recursive: true });
  await writeFile(join(worktreePath, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  await mkdir(join(worktreePath, "docs", "plans"), { recursive: true });
  await mkdir(join(worktreePath, "docs", "specs"), { recursive: true });
  await writeFile(join(worktreePath, PLAN_REL), planMd(planStatus, sourceSpec));
  await writeFile(join(worktreePath, "docs", "plans", "approvals.json"), approvalsJson());
  if (sourceSpec !== "null") {
    await writeFile(join(worktreePath, SPEC_REL), specMd("Approved"));
  }
}

function commonFakes(worktreePath: string) {
  const fakeGit = makeFakeGit();
  fakeGit.impl.setRepoIsClean(true);
  // phase-01 (final): dirty for commitPhase; cleanup is skipped for the final phase.
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

  return { fakeGit, fakeShell, fakeBackend };
}

describe("executePlan — run carries artifact completion (spec 27)", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-run-carry-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("completes the plan and rides the spec along on the run branch, leaving the origin untouched", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);
    const worktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");

    const { fakeGit, fakeShell, fakeBackend } = commonFakes(worktreePath);
    // The completion's transitionArtifact checks dirtyPaths pre-write (must be
    // clean) and post-write (must be dirty so it commits) for the plan, then the
    // spec: enqueue [], writeSet, [], writeSet in order.
    fakeGit.impl.enqueueDirtyPaths([]);
    fakeGit.impl.enqueueDirtyPaths([PLAN_REL]);
    fakeGit.impl.enqueueDirtyPaths([]);
    fakeGit.impl.enqueueDirtyPaths([SPEC_REL]);

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config, PLAN_REL).pipe(Effect.provide(layers)),
    );
    await seedWorktreeArtifacts(worktreePath, "Approved", SPEC_REL);

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
          planRepoRelPath: PLAN_REL,
        }).pipe(Effect.provide(layers)),
      ),
    );

    if (Either.isLeft(result)) console.error("FAILED:", result.left);
    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;

    // The report carries both transitions with their commits.
    const report = result.right.artifactCompletions;
    expect(report).toBeDefined();
    const planTransition = report?.transitions.find((t) => t.kind === "plan");
    const specTransition = report?.transitions.find((t) => t.kind === "spec");
    expect(planTransition).toMatchObject({
      kind: "plan",
      path: PLAN_ARCHIVE,
      alreadyComplete: false,
    });
    expect(specTransition).toMatchObject({
      kind: "spec",
      path: SPEC_ARCHIVE,
      alreadyComplete: false,
    });
    expect(planTransition?.commit?.hash).toBeDefined();
    expect(specTransition?.commit?.hash).toBeDefined();

    // The worktree (the run branch) carries the completed artifacts under archive/.
    expect(await readFile(join(worktreePath, PLAN_ARCHIVE), "utf8")).toContain("status: Completed");
    expect(await readFile(join(worktreePath, SPEC_ARCHIVE), "utf8")).toContain("status: Completed");
    expect(existsSync(join(worktreePath, PLAN_REL))).toBe(false);
    expect(existsSync(join(worktreePath, SPEC_REL))).toBe(false);

    // The origin repository (repoRoot) never saw a docs/ tree — completion is
    // rooted at the worktree (spec 27 §5.5).
    expect(existsSync(join(stateRoot, "docs"))).toBe(false);

    // Completion runs before review opens: review-handoff.md exists AND the
    // completion committed first (a failure would have blocked review entirely).
    expect(existsSync(join(runPath, "review-handoff.md"))).toBe(true);
    const commitCalls = fakeGit.impl.calls.filter((c) => c.method === "commitPaths");
    expect(commitCalls).toHaveLength(2);

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");
  });

  it("pauses the run as interrupted (not review_open) when the plan's transition is illegal", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);
    const worktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");

    const { fakeGit, fakeShell, fakeBackend } = commonFakes(worktreePath);

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config, PLAN_REL).pipe(Effect.provide(layers)),
    );
    // A plan hand-edited to Draft on the branch: Draft → Completed is illegal.
    await seedWorktreeArtifacts(worktreePath, "Draft", "null");

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
          planRepoRelPath: PLAN_REL,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ArtifactCompletionPausedError);
    }

    // The run is interrupted, not review_open; the final phase stays committed.
    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
      stoppedReason?: string;
    };
    expect(runStatus.state).toBe("interrupted");
    expect(runStatus.stoppedReason).toBe("artifact_completion_failed");

    const phaseStatus = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phaseStatus.state).toBe("committed");

    // Review never opened — no completion commit and no review-handoff.md.
    expect(existsSync(join(runPath, "review-handoff.md"))).toBe(false);
    expect(existsSync(join(worktreePath, PLAN_ARCHIVE))).toBe(false);
    // Resume instructions were written for the operator.
    expect(existsSync(join(runPath, "resume-instructions.md"))).toBe(true);
  });
});
