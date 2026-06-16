/**
 * E2E: reset-phase → resume fresh re-execution.
 *
 * Drives a one-phase run to gate exhaustion using fake adapters (no real
 * `claude` binary required), resets the phase via the resetPhase app command,
 * then resumes and asserts the phase re-executes from scratch with a fresh
 * agent invocation off the previous phase's branch.
 *
 * Gate: set PHAX_E2E_RUN=1 to run.
 */

import { Effect, Either, Layer } from "effect";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { resetPhase } from "../../src/app/resetPhase.js";
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
  "Phase completed successfully.",
  "## Key decisions and why",
  "No major decisions.",
  "## Exact locations (file paths and exported names)",
  "No new exports.",
  "## What the next phase needs to know",
  "Ready to proceed.",
].join("\n");

const shouldRun = process.env["PHAX_E2E_RUN"] === "1";

const shortName = Either.getOrThrow(decodeShortName("my-run"));

const rawPlan = {
  version: 1,
  run: { shortName: "my-run", title: "My Run", branch: "ai/my-run" },
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
  ],
} as const;

// Branch phax creates for this phase.
const PHASE_BRANCH = "ai/my-run--phase-01";

describe.skipIf(!shouldRun)("E2E reset-phase → resume fresh re-execution", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-e2e-reset-phase-"));
    // Pre-create the worktree dir so executePlan can write the handoff file there.
    const phase01Worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("resets a gates_exhausted phase, archives its folder, removes worktree and branch, then resumes fresh", async () => {
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

    // --- Step 1: initial run → gate exhaustion ---

    const fakeGit1 = makeFakeGit();
    fakeGit1.impl.setRepoIsClean(true);
    fakeGit1.impl.addExistingBranch(PHASE_BRANCH);

    const fakeShell1 = makeFakeShell();
    fakeShell1.impl.setResponse("true", { exitCode: 1, stdout: "", stderr: "gate failed" });

    const fakeBackend1 = makeFakeBackend();
    fakeBackend1.impl.addRunResponse({
      sessionId: "sess-original" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    fakeBackend1.impl.addResumeResponse({
      sessionId: "sess-fix-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers1 = Layer.mergeAll(
      fakeGit1.layer,
      fakeShell1.layer,
      fakeBackend1.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers1)),
    );

    const firstResult = await Effect.runPromise(
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
        }).pipe(Effect.provide(layers1)),
      ),
    );

    expect(Either.isLeft(firstResult)).toBe(true);
    if (Either.isLeft(firstResult)) {
      expect(firstResult.left).toBeInstanceOf(GateAttemptsExhaustedError);
    }

    const phaseStatus1 = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phaseStatus1.state).toBe("gates_exhausted");

    // Phase folder exists before reset.
    const phaseFolderPath = join(runPath, "phase-01");
    expect(existsSync(phaseFolderPath)).toBe(true);

    // --- Step 2: reset the phase ---

    const fakeGit2 = makeFakeGit();
    fakeGit2.impl.setRepoIsClean(true);
    fakeGit2.impl.addExistingBranch(PHASE_BRANCH);

    const layers2 = Layer.mergeAll(fakeGit2.layer, NodeFileSystemLayer, NoopSystemTelemetryLayer);

    const resetResult = await Effect.runPromise(
      Effect.either(
        resetPhase({
          shortName,
          stateRoot,
          repoRoot: stateRoot,
        }).pipe(
          Effect.provide(layers2),
          // resetPhase requires Shell too; provide a shell that never gets called.
          Effect.provide(makeFakeShell().layer),
        ),
      ),
    );

    expect(Either.isRight(resetResult)).toBe(true);
    if (Either.isRight(resetResult)) {
      const r = resetResult.right;
      expect(r.phaseId).toBe("phase-01");
      expect(r.archivedPath).toBeDefined();
      expect(r.branchDeleted).toBe(true);
    }

    // Phase folder is gone from its original path (archived).
    expect(existsSync(phaseFolderPath)).toBe(false);

    // Branch deletion was recorded by the fake.
    expect(fakeGit2.impl.deletedBranches).toHaveLength(1);
    expect(fakeGit2.impl.deletedBranches[0]?.name).toBe(PHASE_BRANCH);

    // Run state must be resumable.
    const runStatus2 = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
      stoppedReason?: string;
    };
    expect(runStatus2.state).toBe("interrupted");
    expect(runStatus2.stoppedReason).toBe("phase_reset");

    // resume-instructions.md should reference reset-phase.
    await expect(access(join(runPath, "resume-instructions.md"))).resolves.toBeUndefined();

    // --- Step 3: resume → fresh agent invocation ---

    // Re-create the worktree dir for the fresh run.
    const phase01Worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);

    const fakeGit3 = makeFakeGit();
    fakeGit3.impl.setRepoIsClean(true);
    fakeGit3.impl.enqueueWorktreeIsClean(phase01Worktree, false);

    const fakeShell3 = makeFakeShell();
    fakeShell3.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell3.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "abc123def456\n",
      stderr: "",
    });
    fakeShell3.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend3 = makeFakeBackend();
    // Fresh implementation agent invocation.
    fakeBackend3.impl.addRunResponse({
      sessionId: "sess-fresh" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    // Post-commit handoff resume.
    fakeBackend3.impl.addResumeResponse({
      sessionId: "sess-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers3 = Layer.mergeAll(
      fakeGit3.layer,
      fakeShell3.layer,
      fakeBackend3.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const resumeResult = await Effect.runPromise(
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
        }).pipe(Effect.provide(layers3)),
      ),
    );

    expect(Either.isRight(resumeResult)).toBe(true);

    // Fresh agent run call — confirms the phase re-executed from scratch.
    expect(fakeBackend3.impl.runCalls).toHaveLength(1);
    expect(fakeBackend3.impl.runCalls[0]?.options.model).toBeDefined();

    // Phase and run reach completed states.
    const phaseStatus3 = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phaseStatus3.state).toBe("review_open");

    const runStatus3 = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus3.state).toBe("review_open");
  });
});
