import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { HandoffPausedError, UsageLimitError } from "../../src/domain/errors.js";
import { validateHandoffSections } from "../../src/app/handoffGeneration.js";
import { inspectResumeOnDisk } from "../helpers/inspectResume.js";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { planMdFor } from "../helpers/planMarkdown.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { liftFixturePhaxPlanToCurrent } from "../helpers/liftFixturePhaxPlan.js";

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
}

/** Seed a run in `interrupted` with phase-01 paused in `handoff_failed`. */
async function seedHandoffFailedRun(opts: {
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
      stoppedReason: "handoff_failed",
      lastError: "API Error: Connection closed mid-response",
    }),
  );

  const phaseFolder = join(opts.runPath, "phase-01");
  await mkdir(phaseFolder, { recursive: true });

  await writeFile(
    join(phaseFolder, "status.json"),
    JSON.stringify(
      phaseStatusFile({
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "handoff_failed",
        model: "claude-sonnet-4-6",
        effort: "low",
        createdAt: now,
        updatedAt: now,
        branchName: "ai/my-run--phase-01",
        base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        worktreePath: opts.phase01WorktreePath,
        claudeSessionId: opts.claudeSessionId,
        commitHash: "deadbeef01020304",
      }),
    ),
  );

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

  // file-reconciliation.md is written by reconcilePhaseFiles before the
  // handoff step, so it exists on disk even when handoff_failed.
  await writeFile(
    join(phaseFolder, "file-reconciliation.md"),
    "## PHAX File Reconciliation\n\nphax found no file-plan deviations for this phase.\n",
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

describe("executePlan — resume from handoff_failed", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("re-runs only the handoff and continues to the next phase — no second commit", async () => {
    const plan = Either.getOrThrow(liftFixturePhaxPlanToCurrent("phax-plan.json", rawPlan)).plan;
    const config = makeConfig(stateRoot);

    const setupLayers = Layer.mergeAll(
      makeFakeGit().layer,
      makeFakeShell().layer,
      makeFakeBackend().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMdFor(plan), plan, config).pipe(Effect.provide(setupLayers)),
    );

    const phase01WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    const phase02WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-02");

    await seedHandoffFailedRun({
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
    // Phase-01 cleanup: worktree must be clean (committed work, no pending changes).
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, true);
    // Phase-02: dirty so commitPhase actually commits.
    fakeGit.impl.enqueueWorktreeIsClean(phase02WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "cafecafe11223344\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    // resumeAgentSession calls: (1) phase-01 handoff re-run, (2) phase-02 handoff.
    // runAgent calls: (1) phase-02 body — phase-01 body is NOT re-run.
    fakeBackend.impl.setAutoHandoffContent(HANDOFF_CONTENT);
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff-retry" as ClaudeSessionId,
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
      makeFakeGitHub().layer,
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          phaxVersion: "0.0.0-test",
          shortName,
          namespace: "test-project",
          plan,
          planMd: planMdFor(plan),
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

    // Phase-01 handoff re-run + phase-02 handoff = 2 resume calls total.
    expect(fakeBackend.impl.resumeCalls).toHaveLength(2);

    // No second commit on phase-01 branch: only 1 git commit call (phase-02).
    const commitCalls = fakeGit.impl.calls.filter((c) => c.method === "commit");
    expect(commitCalls).toHaveLength(1);

    // Run ends in review_open (phase-02 is the final phase).
    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");

    // Phase-01 handoff file written to run folder (persisted copy).
    const phase01Handoff = await readFile(join(runPath, "phase-01", "phase-handoff.md"), "utf8");
    expect(phase01Handoff).toContain("## What was delivered");

    // Phase-02 ended in review_open.
    const phase02Status = JSON.parse(
      await readFile(join(runPath, "phase-02", "status.json"), "utf8"),
    ) as { state: string; commitHash?: string };
    expect(phase02Status.state).toBe("review_open");
    expect(phase02Status.commitHash).toBe("cafecafe11223344");
  });

  it("pauses again (interrupted) when the handoff re-run fails a second time", async () => {
    const plan = Either.getOrThrow(liftFixturePhaxPlanToCurrent("phax-plan.json", rawPlan)).plan;
    const config = makeConfig(stateRoot);

    const setupLayers = Layer.mergeAll(
      makeFakeGit().layer,
      makeFakeShell().layer,
      makeFakeBackend().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMdFor(plan), plan, config).pipe(Effect.provide(setupLayers)),
    );

    const phase01WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");

    await seedHandoffFailedRun({
      runPath,
      runId,
      phase01WorktreePath,
      claudeSessionId: "sess-01-original",
    });

    await mkdir(join(phase01WorktreePath, ".phax-context"), { recursive: true });

    const fakeGit = makeFakeGit();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    // The handoff re-run fails with a transient error (AgentInvocationError from no response).
    // FakeBackend returns AgentInvocationError when no more resume responses are queued.
    // (We add none, so the first resumeAgentSession call fails.)

    const layers = Layer.mergeAll(
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
          phaxVersion: "0.0.0-test",
          shortName,
          namespace: "test-project",
          plan,
          planMd: planMdFor(plan),
          config,
          gateProfileId: "full",
          allowDirty: true,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );

    // The run pauses again — HandoffPausedError is the clean-pause sentinel.
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(HandoffPausedError);
    }

    // Run remains interrupted (not failed) so it can be resumed again.
    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("interrupted");

    // Phase-01 remains handoff_failed.
    const phase01Status = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phase01Status.state).toBe("handoff_failed");
  });
});

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

// `git` in `cwd`, isolated from the person's configuration by the caller,
// with its messages in English.
function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, LC_ALL: "C" },
  });
}

/** A command line's arguments after the program; its paths hold no space. */
function argsOf(command: string): string[] {
  return command.split(" ").slice(1);
}

// The record writes of an invocation, as the phase id of each.
function recordedPhases(fakeGit: ReturnType<typeof makeFakeGit>): (string | undefined)[] {
  return fakeGit.impl.calls.flatMap((call) =>
    call.method === "writeTreeCommit" ? [call.paths[0]?.split("/")[1]] : [],
  );
}

// A limit inside a committed phase's handoff turn: RateLimitDetected is
// ignored on a committed phase, so the run stays running with the phase
// committed and no run-folder phase-handoff.md.
describe("executePlan — a limit inside a committed phase's handoff turn", () => {
  const threePhasePlan = {
    ...rawPlan,
    phases: [
      ...rawPlan.phases,
      {
        id: "phase-03",
        title: "Third Phase",
        model: "claude-sonnet-4-6",
        effort: "low" as const,
        planMarkdownAnchor: "#phase-03-third",
        plannedFilesToCreate: [] as const,
        plannedFilesToEdit: [] as const,
        optionalFilesToEdit: [] as const,
        commit: { subject: "ai(phase-03): finish", body: "Finishes." },
      },
    ],
  };
  const plan = Either.getOrThrow(
    liftFixturePhaxPlanToCurrent("phax-plan.json", threePhasePlan),
  ).plan;
  const RESUMED_HANDOFF = HANDOFF_CONTENT.replace(
    "Ready to proceed.",
    "Written by the resumed handoff turn.",
  );

  let stateRoot: string;
  let runPath: string;
  let runId: string;
  let config: ResolvedConfig;

  const worktreeOf = (phaseId: string) =>
    join(stateRoot, "worktrees", "test-project.my-run", phaseId);
  const runHandoffOf = (phaseId: string) => join(runPath, phaseId, "phase-handoff.md");

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-"));
    config = makeConfig(stateRoot);
    ({ runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMdFor(plan), plan, config).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeFakeGit().layer,
            makeFakeShell().layer,
            makeFakeBackend().layer,
            NodeFileSystemLayer,
            NoopSystemTelemetryLayer,
          ),
        ),
      ),
    ));
    // The fake git creates no directory.
    for (const id of ["phase-01", "phase-02", "phase-03"]) {
      await mkdir(join(worktreeOf(id), ".phax-context"), { recursive: true });
    }
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  /**
   * One `phax run` or `phax resume` invocation from `startIndex`. `bodies` are
   * the phases whose agent body runs (each commits); `handoffTurns` how many
   * handoff turns are answered; `limitAtTurn` the resume call that hits a limit.
   */
  async function invoke(opts: {
    readonly startIndex: number;
    readonly bodies: readonly string[];
    readonly handoffTurns: number;
    readonly limitAtTurn?: number;
    readonly cleanups: readonly string[];
    readonly handoff: string;
  }) {
    const fakeGit = makeFakeGit();
    for (const id of opts.bodies) {
      fakeGit.impl.enqueueWorktreeIsClean(worktreeOf(id), false);
    }
    for (const id of opts.cleanups) {
      fakeGit.impl.enqueueWorktreeIsClean(worktreeOf(id), true);
    }
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "cafecafe11223344\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });
    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.setAutoHandoffContent(opts.handoff);
    for (const id of opts.bodies) {
      fakeBackend.impl.addRunResponse({
        sessionId: `sess-${id}` as ClaudeSessionId,
        outputPath: "",
        finalText: "",
      });
    }
    for (let i = 0; i < opts.handoffTurns; i++) {
      fakeBackend.impl.addResumeResponse({
        sessionId: `sess-handoff-${i}` as ClaudeSessionId,
        outputPath: "",
        finalText: "",
      });
    }
    if (opts.limitAtTurn !== undefined) {
      fakeBackend.impl.failResumeWithRateLimit(opts.limitAtTurn, { kind: "usage_limit" });
    }
    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          phaxVersion: "0.0.0-test",
          shortName,
          namespace: "test-project",
          plan,
          planMd: planMdFor(plan),
          config,
          gateProfileId: "full",
          allowDirty: true,
          runPath,
          runId: runId as never,
          startIndex: opts.startIndex,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              fakeGit.layer,
              fakeShell.layer,
              fakeBackend.layer,
              NodeFileSystemLayer,
              NoopSystemTelemetryLayer,
              makeFakeGitHub().layer,
            ),
          ),
        ),
      ),
    );
    // A provider adapter records its session id in the phase status
    // (persistSessionId); the fake backend does not, so play it here.
    for (const id of opts.bodies) {
      const path = join(runPath, id, "status.json");
      if (!existsSync(path)) continue;
      const status = await readJson(path);
      await writeFile(path, JSON.stringify({ ...status, claudeSessionId: `sess-${id}` }));
    }
    return { result, fakeBackend, fakeGit };
  }

  // phase-01 commits, and a usage limit cuts its handoff turn short.
  async function pauseInPhase01Handoff(): Promise<void> {
    const { result } = await invoke({
      startIndex: 0,
      bodies: ["phase-01"],
      handoffTurns: 0,
      limitAtTurn: 0,
      cleanups: [],
      handoff: HANDOFF_CONTENT,
    });
    expect(Either.isLeft(result) && result.left).toBeInstanceOf(UsageLimitError);
  }

  async function decide() {
    return inspectResumeOnDisk("test-project", shortName, stateRoot);
  }

  it("(a) the resume writes a non-final phase's handoff first, and the next prompt carries it", async () => {
    await pauseInPhase01Handoff();
    expect((await readJson(join(runPath, "run-status.json")))["state"]).toBe("running");
    expect((await readJson(join(runPath, "phase-01", "status.json")))["state"]).toBe("committed");
    expect(existsSync(runHandoffOf("phase-01"))).toBe(false);
    expect(existsSync(worktreeOf("phase-01"))).toBe(true);

    const decision = await decide();
    if (Either.isLeft(decision)) throw new Error(decision.left.message);
    expect(decision.right.nextPhaseId).toBe("phase-01");

    const { result, fakeBackend, fakeGit } = await invoke({
      startIndex: decision.right.nextPhaseIndex,
      bodies: ["phase-02", "phase-03"],
      handoffTurns: 3,
      cleanups: ["phase-01", "phase-02"],
      handoff: RESUMED_HANDOFF,
    });

    if (Either.isLeft(result)) throw result.left;
    expect(result.right.completedPhaseCount).toBe(3);
    // Only the handoff turn of phase-01 ran again, in its own session.
    expect(fakeBackend.impl.resumeCalls[0]?.sessionId).toBe("sess-phase-01");
    expect(fakeBackend.impl.runCalls.map((c) => c.options.phaseFolderPath)).toEqual([
      join(runPath, "phase-02"),
      join(runPath, "phase-03"),
    ]);
    expect(fakeGit.impl.calls.filter((c) => c.method === "commit")).toHaveLength(2);
    expect(validateHandoffSections(await readFile(runHandoffOf("phase-01"), "utf8"))).toEqual([]);
    const phase02Prompt = fakeBackend.impl.runCalls[0]?.prompt ?? "";
    expect(phase02Prompt).toContain("Written by the resumed handoff turn.");
    expect(phase02Prompt).not.toContain("(no previous phase)");
    expect((await readJson(join(runPath, "run-status.json")))["state"]).toBe("review_open");
  });

  it("(b) the resume writes the final phase's handoff, completes the plan and opens review", async () => {
    const { result: first } = await invoke({
      startIndex: 0,
      bodies: ["phase-01", "phase-02", "phase-03"],
      handoffTurns: 2,
      limitAtTurn: 2,
      cleanups: ["phase-01", "phase-02"],
      handoff: HANDOFF_CONTENT,
    });
    expect(Either.isLeft(first) && first.left).toBeInstanceOf(UsageLimitError);
    expect((await readJson(join(runPath, "phase-03", "status.json")))["state"]).toBe("committed");
    expect(existsSync(runHandoffOf("phase-03"))).toBe(false);

    const decision = await decide();
    if (Either.isLeft(decision)) throw new Error(decision.left.message);
    expect(decision.right.nextPhaseId).toBe("phase-03");

    const { result } = await invoke({
      startIndex: decision.right.nextPhaseIndex,
      bodies: [],
      handoffTurns: 1,
      cleanups: [],
      handoff: RESUMED_HANDOFF,
    });

    if (Either.isLeft(result)) throw result.left;
    expect(result.right.completedPhaseCount).toBe(3);
    expect(validateHandoffSections(await readFile(runHandoffOf("phase-03"), "utf8"))).toEqual([]);
    expect(existsSync(join(runPath, "review-handoff.md"))).toBe(true);
    expect((await readJson(join(runPath, "run-status.json")))["state"]).toBe("review_open");
  });

  it("(c) a second limit in the regenerated handoff turn leaves the phase owing; a third invocation finishes", async () => {
    await pauseInPhase01Handoff();

    const { result: second } = await invoke({
      startIndex: 0,
      bodies: [],
      handoffTurns: 0,
      limitAtTurn: 0,
      cleanups: [],
      handoff: RESUMED_HANDOFF,
    });
    expect(Either.isLeft(second) && second.left).toBeInstanceOf(UsageLimitError);
    expect((await readJson(join(runPath, "phase-01", "status.json")))["state"]).toBe("committed");
    expect(existsSync(runHandoffOf("phase-01"))).toBe(false);

    const decision = await decide();
    if (Either.isLeft(decision)) throw new Error(decision.left.message);
    expect(decision.right.nextPhaseId).toBe("phase-01");

    const { result } = await invoke({
      startIndex: decision.right.nextPhaseIndex,
      bodies: ["phase-02", "phase-03"],
      handoffTurns: 3,
      cleanups: ["phase-01", "phase-02"],
      handoff: RESUMED_HANDOFF,
    });
    if (Either.isLeft(result)) throw result.left;
    expect(validateHandoffSections(await readFile(runHandoffOf("phase-01"), "utf8"))).toEqual([]);
    expect((await readJson(join(runPath, "run-status.json")))["state"]).toBe("review_open");
  });

  it("(d) refuses an owing phase whose worktree is gone, and resumes once its remedy restores it", async () => {
    await pauseInPhase01Handoff();
    const restoreGit = isolateGit();
    try {
      // A real main checkout holding the phase branch, whose worktree at the
      // recorded path was added and then deleted: git still registers it.
      const repo = join(stateRoot, "repo");
      git(stateRoot, ["init", "-q", "-b", "main", repo]);
      writeFileSync(join(repo, "README.md"), "A made-up repository.\n");
      git(repo, ["add", "README.md"]);
      git(repo, [
        "-c",
        "user.name=Ada Example",
        "-c",
        "user.email=ada@example.com",
        "commit",
        "-q",
        "-m",
        "Initial commit",
      ]);
      git(repo, ["branch", "ai/my-run--phase-01"]);
      await rm(worktreeOf("phase-01"), { recursive: true, force: true });
      git(repo, ["worktree", "add", "-q", worktreeOf("phase-01"), "ai/my-run--phase-01"]);
      await rm(worktreeOf("phase-01"), { recursive: true, force: true });
      await refuseThenRestore(repo);
    } finally {
      restoreGit();
    }
  });

  async function refuseThenRestore(repo: string): Promise<void> {
    const before = {
      run: await readFile(join(runPath, "run-status.json"), "utf8"),
      phase: await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    };

    const refused = await decide();
    if (Either.isRight(refused)) throw new Error("expected a refusal");
    expect(refused.left.reason).toBe("handoff_unrecoverable");
    expect(refused.left.message).toContain(
      `its worktree "${worktreeOf("phase-01")}" no longer exists`,
    );
    expect(await readFile(join(runPath, "run-status.json"), "utf8")).toBe(before.run);
    expect(await readFile(join(runPath, "phase-01", "status.json"), "utf8")).toBe(before.phase);

    // The remedy's git commands, run as the message names them.
    const commands = [...refused.left.message.matchAll(/`(git [^`]+)`/g)].map((m) => m[1] ?? "");
    expect(commands).toEqual([
      "git worktree prune",
      `git worktree add ${worktreeOf("phase-01")} ai/my-run--phase-01`,
    ]);
    // `git worktree add` alone refuses the missing but registered worktree.
    expect(() => git(repo, argsOf(commands[1] ?? ""))).toThrow(/missing but already registered/);
    for (const command of commands) git(repo, argsOf(command));
    expect(existsSync(join(worktreeOf("phase-01"), "README.md"))).toBe(true);

    await mkdir(join(worktreeOf("phase-01"), ".phax-context"), { recursive: true });
    const decision = await decide();
    if (Either.isLeft(decision)) throw new Error(decision.left.message);
    expect(decision.right.nextPhaseId).toBe("phase-01");

    const { result } = await invoke({
      startIndex: decision.right.nextPhaseIndex,
      bodies: ["phase-02", "phase-03"],
      handoffTurns: 3,
      cleanups: ["phase-01", "phase-02"],
      handoff: RESUMED_HANDOFF,
    });
    if (Either.isLeft(result)) throw result.left;
    expect(validateHandoffSections(await readFile(runHandoffOf("phase-01"), "utf8"))).toEqual([]);
  }

  async function dropSessionId(phaseId: string): Promise<void> {
    const path = join(runPath, phaseId, "status.json");
    const status = await readJson(path);
    delete status["claudeSessionId"];
    await writeFile(path, JSON.stringify(status));
  }

  it("(e) refuses an owing phase whose session id is gone, naming the file to write by hand", async () => {
    await pauseInPhase01Handoff();
    await dropSessionId("phase-01");

    const refused = await decide();
    if (Either.isRight(refused)) throw new Error("expected a refusal");
    expect(refused.left.reason).toBe("handoff_unrecoverable");
    expect(refused.left.message).toContain("no session id is recorded for it");
    expect(refused.left.message).toContain(`Write ${runHandoffOf("phase-01")} by hand`);
    expect(refused.left.message).not.toContain("git worktree add");
  });

  it("(e) a final phase with its worktree and session id gone also names git worktree add", async () => {
    const { result: first } = await invoke({
      startIndex: 0,
      bodies: ["phase-01", "phase-02", "phase-03"],
      handoffTurns: 2,
      limitAtTurn: 2,
      cleanups: ["phase-01", "phase-02"],
      handoff: HANDOFF_CONTENT,
    });
    expect(Either.isLeft(first)).toBe(true);
    await dropSessionId("phase-03");
    await rm(worktreeOf("phase-03"), { recursive: true, force: true });

    const refused = await decide();
    if (Either.isRight(refused)) throw new Error("expected a refusal");
    expect(refused.left.reason).toBe("handoff_unrecoverable");
    expect(refused.left.message).toContain("no session id is recorded for it");
    expect(refused.left.message).toContain(`Write ${runHandoffOf("phase-03")} by hand`);
    expect(refused.left.message).toContain(
      `git worktree add ${worktreeOf("phase-03")} ai/my-run--phase-03`,
    );
  });

  const HAND_WRITTEN = HANDOFF_CONTENT.replace("Ready to proceed.", "Written by hand.");

  it("(f) a hand-written handoff lifts the session-gone refusal; the resume finishes that phase first", async () => {
    await pauseInPhase01Handoff();
    await dropSessionId("phase-01");
    await writeFile(runHandoffOf("phase-01"), HAND_WRITTEN);
    config = { ...config, records: { ...config.records, enabled: true } };

    const decision = await decide();
    if (Either.isLeft(decision)) throw new Error(decision.left.message);
    expect(decision.right).toMatchObject({ nextPhaseId: "phase-01", owedStep: "post-handoff" });

    const { result, fakeBackend, fakeGit } = await invoke({
      startIndex: decision.right.nextPhaseIndex,
      bodies: ["phase-02", "phase-03"],
      handoffTurns: 2,
      cleanups: ["phase-01", "phase-02"],
      handoff: HANDOFF_CONTENT,
    });
    if (Either.isLeft(result)) throw result.left;
    // phase-01 runs no agent turn: only the next phases' bodies and handoffs.
    expect(fakeBackend.impl.runCalls.map((c) => c.options.phaseFolderPath)).toEqual([
      join(runPath, "phase-02"),
      join(runPath, "phase-03"),
    ]);
    expect(fakeBackend.impl.resumeCalls).toHaveLength(2);
    expect(await readFile(runHandoffOf("phase-01"), "utf8")).toBe(HAND_WRITTEN);
    expect(fakeBackend.impl.runCalls[0]?.prompt).toContain("Written by hand.");
    // Its record, then its cleanup, before phase-02 starts.
    expect(recordedPhases(fakeGit)).toEqual(["phase-01", "phase-02", "phase-03"]);
    expect((await readJson(join(runPath, "phase-01", "status.json")))["state"]).toBe("cleaned_up");
    expect(result.right.completedPhaseCount).toBe(3);
  });

  it("(f) with its worktree gone too, the phase is cleaned up, warning of the cleanup commands not run", async () => {
    await pauseInPhase01Handoff();
    await dropSessionId("phase-01");
    await writeFile(runHandoffOf("phase-01"), HAND_WRITTEN);
    await rm(worktreeOf("phase-01"), { recursive: true, force: true });
    config = {
      ...config,
      raw: {
        ...config.raw,
        commands: { setup: ["true"], cleanup: ["true", "docker compose down"] },
      },
    };
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const decision = await decide();
    if (Either.isLeft(decision)) throw new Error(decision.left.message);
    expect(decision.right).toMatchObject({ nextPhaseId: "phase-01", owedStep: "post-handoff" });

    const { result, fakeGit } = await invoke({
      startIndex: decision.right.nextPhaseIndex,
      bodies: ["phase-02", "phase-03"],
      handoffTurns: 2,
      cleanups: ["phase-02"],
      handoff: HANDOFF_CONTENT,
    });
    if (Either.isLeft(result)) throw result.left;
    expect((await readJson(join(runPath, "phase-01", "status.json")))["state"]).toBe("cleaned_up");
    // Nothing checked or recreated the gone worktree.
    expect(
      fakeGit.impl.calls.some(
        (c) => c.method === "worktreeIsClean" && c.path === worktreeOf("phase-01"),
      ),
    ).toBe(false);
    expect(existsSync(worktreeOf("phase-01"))).toBe(false);
    expect((await readJson(join(runPath, "run-status.json")))["state"]).toBe("review_open");
    const warnings = stderr.mock.calls.map(([chunk]) => String(chunk));
    stderr.mockRestore();
    expect(warnings).toContain(
      '[phax] Warning: phase "phase-01" — its worktree is gone, so its cleanup commands did not run: true; docker compose down. Run them yourself if they free resources outside the worktree.\n',
    );
  });
});
