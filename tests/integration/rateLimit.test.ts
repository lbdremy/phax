import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { inspectResume } from "../../src/app/resume.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { RateLimitError, UsageLimitError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
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

describe("executePlan — rate-limit detection and resume", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("stops the run as rate_limited and writes resume-instructions.md", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    // phase-01's agent invocation (runAgent call index 0) hits a rate limit.
    fakeBackend.impl.failRunWithRateLimit(0, {
      kind: "rate_limit",
      resetAt: "2026-05-16T12:00:00Z",
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

    // The limit error is re-raised so the CLI still exits non-zero.
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RateLimitError);
      expect(exitCodeForError(result.left)).toBe(8);
    }

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
      stoppedReason?: string;
      lastError?: string;
    };
    expect(runStatus.state).toBe("rate_limited");
    expect(runStatus.stoppedReason).toBe("rate_limited");
    expect(runStatus.lastError).toBeTruthy();

    const phaseStatus = JSON.parse(
      await readFile(join(runPath, "phase-01", "status.json"), "utf8"),
    ) as { state: string };
    expect(phaseStatus.state).toBe("rate_limited");

    const instructions = await readFile(join(runPath, "resume-instructions.md"), "utf8");
    expect(instructions).toContain("Rate limit");
    expect(instructions).toContain("2026-05-16T12:00:00Z");
    expect(instructions).toContain("phax resume my-run");
    expect(instructions).toContain("phase-01");
  });

  it("classifies a usage limit and exits with code 8", async () => {
    const plan = Either.getOrThrow(decodePhaxPlan(rawPlan));
    const config = makeConfig(stateRoot);

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    const fakeBackend = makeFakeBackend();
    fakeBackend.impl.failRunWithRateLimit(0, { kind: "usage_limit" });

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

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UsageLimitError);
      expect(exitCodeForError(result.left)).toBe(8);
    }
    const instructions = await readFile(join(runPath, "resume-instructions.md"), "utf8");
    expect(instructions).toContain("Usage limit");
  });

  it("resumes a rate-limited run to review_open without re-running committed phases", async () => {
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

    const now = new Date().toISOString();

    // phase-01 already completed before the limit was hit.
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
        worktreePath: join(stateRoot, "worktrees", "test-project.my-run", "phase-01"),
        commitHash: "aabbccdd11223344",
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

    // phase-02 was in flight when the rate limit hit — folder + worktree preserved.
    const phase02FolderPath = join(runPath, "phase-02");
    const phase02WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-02");
    await mkdir(phase02FolderPath, { recursive: true });
    await mkdir(join(phase02WorktreePath, ".phax-context"), { recursive: true });
    await writeFile(
      join(phase02WorktreePath, ".phax-context", "phase-handoff.md"),
      HANDOFF_CONTENT,
    );
    await writeFile(
      join(phase02FolderPath, "status.json"),
      JSON.stringify({
        version: 1,
        phaseId: "phase-02",
        phaseIndex: 1,
        state: "rate_limited",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: "ai/my-run--phase-02",
        createdAt: now,
        updatedAt: now,
        worktreePath: phase02WorktreePath,
        claudeSessionId: "sess-02-partial",
      }),
    );

    // Run was paused as rate_limited.
    await writeFile(
      join(runPath, "run-status.json"),
      JSON.stringify({
        version: 1,
        namespace: "test-project",
        shortName: "my-run",
        runId,
        state: "rate_limited",
        createdAt: now,
        updatedAt: now,
        phasesCount: 2,
        gateProfileId: "full",
        stoppedReason: "rate_limited",
        lastError: "Claude Code stopped: rate limit hit.",
      }),
    );

    // `phax resume` resolves the next resumable phase from the rate-limited run.
    const decision = inspectResume("test-project", shortName, stateRoot);
    expect(Either.isRight(decision)).toBe(true);
    if (Either.isLeft(decision)) throw new Error("expected resumable run");
    expect(decision.right.fromState).toBe("rate_limited");
    expect(decision.right.nextPhaseId).toBe("phase-02");
    expect(decision.right.nextPhaseIndex).toBe(1);

    const fakeGit = makeFakeGit();
    fakeGit.impl.enqueueWorktreeIsClean(phase02WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
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
          namespace: "test-project",
          plan,
          planMd: "# My Plan",
          config,
          gateProfileId: "full",
          allowDirty: true,
          runPath,
          runId,
          startIndex: decision.right.nextPhaseIndex,
        }).pipe(Effect.provide(resumeLayers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    // phase-01 was not touched — still committed, no worktree re-created.
    const phase01Status = JSON.parse(
      await readFile(join(phase01FolderPath, "status.json"), "utf8"),
    ) as { state: string };
    expect(phase01Status.state).toBe("committed");
    expect(fakeGit.impl.calls.some((c) => c.method === "addWorktree")).toBe(false);

    // phase-02 ran to completion and the run reached review_open.
    const phase02Status = JSON.parse(
      await readFile(join(phase02FolderPath, "status.json"), "utf8"),
    ) as { state: string };
    expect(phase02Status.state).toBe("review_open");

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");

    // The preserved worktree was reused, not recreated.
    expect(existsSync(phase02WorktreePath)).toBe(true);
  });
});
