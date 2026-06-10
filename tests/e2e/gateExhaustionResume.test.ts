import { Effect, Either, Layer } from "effect";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { inspectResume } from "../../src/app/resume.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { GateAttemptsExhaustedError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { decodePhaxPlan } from "../../src/schemas/phaxPlan.js";

const HANDOFF_CONTENT = [
  "## What was delivered",
  "Gate-first resume completed.",
  "## Key decisions and why",
  "No new decisions.",
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
  ],
} as const;

function makeConfig(stateRoot: string): ResolvedConfig {
  return {
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
    },
  };
}

describe("E2E gate exhaustion resume", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-e2e-gate-resume-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("pauses in gates_exhausted, then gate-first resume commits without a fresh agent run", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(worktreePath, ".phax-context"), { recursive: true });

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.enqueue(
      { exitCode: 1, stdout: "", stderr: "initial gate failure\n" },
      { exitCode: 1, stdout: "", stderr: "still red after agent fix\n" },
      { exitCode: 0, stdout: "human fix passed\n", stderr: "" },
      { exitCode: 0, stdout: "abc123def456\n", stderr: "" },
      { exitCode: 0, stdout: "", stderr: "" },
    );

    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.addRunResponse({
      sessionId: "sess-implementation" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-after-fix" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-handoff" as ClaudeSessionId,
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

    const exhausted = await Effect.runPromise(
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

    expect(Either.isLeft(exhausted)).toBe(true);
    if (Either.isLeft(exhausted)) {
      expect(exhausted.left).toBeInstanceOf(GateAttemptsExhaustedError);
    }

    const runStatusAfterExhaustion = JSON.parse(
      await readFile(join(runPath, "run-status.json"), "utf8"),
    ) as { state: string; stoppedReason?: string };
    expect(runStatusAfterExhaustion.state).toBe("interrupted");
    expect(runStatusAfterExhaustion.stoppedReason).toBe("gates_exhausted");

    const phaseFolderPath = join(runPath, "phase-01");
    const phaseStatusAfterExhaustion = JSON.parse(
      await readFile(join(phaseFolderPath, "status.json"), "utf8"),
    ) as { state: string; claudeSessionId?: string; worktreePath?: string };
    expect(phaseStatusAfterExhaustion.state).toBe("gates_exhausted");
    expect(phaseStatusAfterExhaustion.claudeSessionId).toBe("sess-implementation");
    expect(phaseStatusAfterExhaustion.worktreePath).toBe(worktreePath);
    expect(existsSync(join(runPath, "resume-instructions.md"))).toBe(true);

    const decision = inspectResume(shortName, stateRoot);
    expect(Either.isRight(decision)).toBe(true);
    if (Either.isLeft(decision))
      throw new Error(`expected decision, got: ${decision.left.message}`);
    expect(decision.right.nextPhaseId).toBe("phase-01");
    expect(decision.right.nextPhaseIndex).toBe(0);
    expect(decision.right.worktreePath).toBe(worktreePath);

    fakeBackend.impl.setAutoHandoffContent(HANDOFF_CONTENT);

    const resumed = await Effect.runPromise(
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
          startIndex: decision.right.nextPhaseIndex,
        }).pipe(Effect.provide(layers)),
      ),
    );

    expect(Either.isRight(resumed)).toBe(true);
    expect(fakeBackend.impl.runCalls).toHaveLength(1);
    expect(fakeBackend.impl.resumeCalls).toHaveLength(2);
    expect(fakeBackend.impl.resumeCalls[1]?.sessionId).toBe("sess-implementation");
    expect(existsSync(join(phaseFolderPath, "checks-attempt-03.log"))).toBe(true);

    const phaseStatusAfterResume = JSON.parse(
      await readFile(join(phaseFolderPath, "status.json"), "utf8"),
    ) as { state: string; commitHash?: string };
    expect(phaseStatusAfterResume.state).toBe("review_open");
    expect(phaseStatusAfterResume.commitHash).toBe("abc123def456");

    const runStatusAfterResume = JSON.parse(
      await readFile(join(runPath, "run-status.json"), "utf8"),
    ) as { state: string };
    expect(runStatusAfterResume.state).toBe("review_open");
  });
});
