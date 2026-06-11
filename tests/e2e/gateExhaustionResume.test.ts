/**
 * E2E: gate-exhaustion pause → gate-first resume.
 *
 * Drives a one-phase run to gate exhaustion using fake adapters (no real
 * `claude` binary required), verifies the run parks in `gates_exhausted` with
 * `resume-instructions.md` present, then resumes with the gate now passing and
 * asserts the phase commits without a fresh agent invocation.
 *
 * Gate: set PHAX_E2E_RUN=1 to run.
 */

import { Effect, Either, Layer } from "effect";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
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

describe.skipIf(!shouldRun)("E2E gate-exhaustion resume", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-e2e-gate-exhaust-"));
    const phase01Worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("pauses in gates_exhausted then gate-first resumes and commits without a fresh agent invocation", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const worktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

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

    // --- Phase 1: initial run → gate exhaustion ---

    const fakeGit1 = makeFakeGit();
    fakeGit1.impl.setRepoIsClean(true);

    const fakeShell1 = makeFakeShell();
    // Gate command always fails — budget exhausted after maxFixAttempts=1 fix.
    fakeShell1.impl.setResponse("true", { exitCode: 1, stdout: "", stderr: "gate failed" });

    const fakeBackend1 = makeFakeBackend();
    // Implementation agent invocation.
    fakeBackend1.impl.addRunResponse({
      sessionId: "sess-original" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    // One fix attempt (maxFixAttempts = 1).
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

    // The run must pause with GateAttemptsExhaustedError (resumable, not fatal).
    expect(Either.isLeft(firstResult)).toBe(true);
    if (Either.isLeft(firstResult)) {
      expect(firstResult.left).toBeInstanceOf(GateAttemptsExhaustedError);
    }

    // Run state: interrupted (resumable).
    const runStatus1 = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
      stoppedReason?: string;
    };
    expect(runStatus1.state).toBe("interrupted");
    expect(runStatus1.stoppedReason).toBe("gates_exhausted");

    // Phase state: gates_exhausted (non-terminal, carries attempt number).
    const phaseStatus1 = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phaseStatus1.state).toBe("gates_exhausted");

    // resume-instructions.md must exist and reference the key operator commands.
    await expect(access(join(runPath, "resume-instructions.md"))).resolves.toBeUndefined();
    const resumeInstructions = await readFile(join(runPath, "resume-instructions.md"), "utf8");
    expect(resumeInstructions).toContain("phax resume my-run");
    expect(resumeInstructions).toContain("phax reset-phase my-run phase-01");

    // The implementation agent was called exactly once for the initial run.
    expect(fakeBackend1.impl.runCalls).toHaveLength(1);

    // --- "Human fix": switch the gate to pass ---

    const fakeGit2 = makeFakeGit();
    fakeGit2.impl.setRepoIsClean(true);
    // Worktree is dirty (has changes to commit) during commitPhase.
    fakeGit2.impl.enqueueWorktreeIsClean(worktreePath, false);

    const fakeShell2 = makeFakeShell();
    // Gate passes after the human-applied fix.
    fakeShell2.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell2.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "abc123def456\n",
      stderr: "",
    });
    fakeShell2.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend2 = makeFakeBackend();
    // Only the post-commit handoff resume should be invoked — no agent run.
    fakeBackend2.impl.addResumeResponse({
      sessionId: "sess-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const layers2 = Layer.mergeAll(
      fakeGit2.layer,
      fakeShell2.layer,
      fakeBackend2.layer,
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
        }).pipe(Effect.provide(layers2)),
      ),
    );

    // The resumed run must succeed.
    expect(Either.isRight(resumeResult)).toBe(true);

    // No implementation-agent call on gate-first resume.
    expect(fakeBackend2.impl.runCalls).toHaveLength(0);
    // No fix agents called either (gate passed on first attempt after resume).
    const fixCalls = fakeBackend2.impl.resumeCalls.filter((c) =>
      c.options.outputJsonlPath?.includes("fix-attempt-"),
    );
    expect(fixCalls).toHaveLength(0);

    // Phase and run reach their committed / review_open terminal states.
    const phaseStatus2 = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phaseStatus2.state).toBe("review_open");

    const runStatus2 = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus2.state).toBe("review_open");
  });
});
