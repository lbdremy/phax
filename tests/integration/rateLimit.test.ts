import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import { exitCodeForError } from "../../src/cli/commands/runLayers.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { currentSchemaUrl, readPhaxPlanFile } from "../../src/schemas/persisted.js";

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

describe("executePlan — rate-limit detection and resume", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("stops the run as rate_limited and writes resume-instructions.md", async () => {
    const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan));
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
    const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan));
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

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UsageLimitError);
      expect(exitCodeForError(result.left)).toBe(8);
    }
    const instructions = await readFile(join(runPath, "resume-instructions.md"), "utf8");
    expect(instructions).toContain("Usage limit");
  });

  it("resumes a rate-limited run to review_open without re-running committed phases", async () => {
    const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan));
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
        $schema: currentSchemaUrl("phase-status"),
        phaseId: "phase-01",
        phaseIndex: 0,
        state: "committed",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: "ai/my-run--phase-01",
        base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
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
        $schema: currentSchemaUrl("phase-status"),
        phaseId: "phase-02",
        phaseIndex: 1,
        state: "rate_limited",
        model: "claude-sonnet-4-6",
        effort: "low",
        branchName: "ai/my-run--phase-02",
        base: "b2c3d4e5f60718293a4b5c6d7e8f901234567890",
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

  it("continues gate attempt numbering after a fix attempt hit a rate limit, overwriting nothing", async () => {
    const plan = Either.getOrThrow(
      readPhaxPlanFile("phax-plan.json", { ...rawPlan, phases: [rawPlan.phases[0]] }),
    );
    const gateCommand = "node scripts/check.mjs";
    const config: ResolvedConfig = {
      ...makeConfig(stateRoot),
      maxFixAttempts: 2,
      raw: {
        ...makeConfig(stateRoot).raw,
        gateProfiles: {
          full: [{ command: gateCommand, surface: "local", firing: "every-phase", output: "log" }],
        },
      },
    };

    // First entry: gate attempts 01 and 02 fail, and fix attempt 02 hits a rate limit.
    const firstGit = makeFakeGit();
    firstGit.impl.setRepoIsClean(true);
    const firstShell = makeFakeShell();
    firstShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    firstShell.impl.setResponse(gateCommand, { exitCode: 1, stdout: "", stderr: "check failed" });
    const firstBackend = makeFakeBackend();
    firstBackend.impl.addRunResponse({
      sessionId: "sess-01" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    firstBackend.impl.addResumeResponse({
      sessionId: "sess-01-fix" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    firstBackend.impl.failResumeWithRateLimit(1, {
      kind: "rate_limit",
      resetAt: "2026-10-10T12:00:00Z",
    });
    const firstLayers = Layer.mergeAll(
      firstGit.layer,
      firstShell.layer,
      firstBackend.layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
      makeFakeGitHub().layer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(firstLayers)),
    );
    const executeOptions = {
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
    };

    const first = await Effect.runPromise(
      Effect.either(executePlan(executeOptions).pipe(Effect.provide(firstLayers))),
    );
    expect(Either.isLeft(first) && first.left instanceof RateLimitError).toBe(true);
    expect(firstBackend.impl.resumeCalls.map((call) => call.options.outputJsonlPath)).toEqual([
      join(runPath, "phase-01", "fix-attempt-01.jsonl"),
      join(runPath, "phase-01", "fix-attempt-02.jsonl"),
    ]);

    const phaseFolder = join(runPath, "phase-01");
    const firstEntryNames = (await readdir(phaseFolder)).filter((name) =>
      name.startsWith("checks-attempt-"),
    );
    expect(firstEntryNames.toSorted()).toEqual([
      "checks-attempt-01.attribution.json",
      "checks-attempt-01.log",
      "checks-attempt-02.attribution.json",
      "checks-attempt-02.log",
    ]);
    const firstEntry = new Map<string, Buffer>();
    for (const name of firstEntryNames) {
      firstEntry.set(name, await readFile(join(phaseFolder, name)));
    }

    // `phax resume` re-enters the rate-limited phase; the gate now passes.
    const decision = inspectResume("test-project", shortName, stateRoot);
    if (Either.isLeft(decision)) throw new Error("expected resumable run");
    expect(decision.right.nextPhaseId).toBe("phase-01");

    const phaseStatus = JSON.parse(await readFile(join(phaseFolder, "status.json"), "utf8")) as {
      worktreePath: string;
    };
    await mkdir(join(phaseStatus.worktreePath, ".phax-context"), { recursive: true });
    await writeFile(
      join(phaseStatus.worktreePath, ".phax-context", "phase-handoff.md"),
      HANDOFF_CONTENT,
    );

    const resumeGit = makeFakeGit();
    resumeGit.impl.enqueueWorktreeIsClean(phaseStatus.worktreePath, false);
    const resumeShell = makeFakeShell();
    resumeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    resumeShell.impl.setResponse(gateCommand, { exitCode: 0, stdout: "ok", stderr: "" });
    resumeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef\n",
      stderr: "",
    });
    resumeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });
    const resumeBackend = makeFakeBackend();
    resumeBackend.impl.addRunResponse({
      sessionId: "sess-01-resumed" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });
    resumeBackend.impl.addResumeResponse({
      sessionId: "sess-01-handoff" as ClaudeSessionId,
      outputPath: "",
      finalText: "",
    });

    const resumed = await Effect.runPromise(
      Effect.either(
        executePlan({ ...executeOptions, startIndex: decision.right.nextPhaseIndex }).pipe(
          Effect.provide(
            Layer.mergeAll(
              resumeGit.layer,
              resumeShell.layer,
              resumeBackend.layer,
              NodeFileSystemLayer,
              NoopSystemTelemetryLayer,
              makeFakeGitHub().layer,
            ),
          ),
        ),
      ),
    );
    expect(Either.isRight(resumed)).toBe(true);

    // The re-entry's gate ran as attempt 03; the first entry's files are as they were.
    expect(existsSync(join(phaseFolder, "checks-attempt-03.log"))).toBe(true);
    for (const [name, content] of firstEntry) {
      expect(await readFile(join(phaseFolder, name))).toEqual(content);
    }
  });
});
