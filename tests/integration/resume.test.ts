import { Effect, Either, Layer } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { loadConfig } from "../../src/app/loadConfig.js";
import { loadOrExtractPlan } from "../../src/app/loadOrExtractPlan.js";
import { setRunStatus } from "../../src/app/registry.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { runResume } from "../../src/cli/commands/resume.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { readPhaxPlanFile } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { planMdFor } from "../helpers/planMarkdown.js";
import {
  createPreflightRepo,
  FIXTURE_EFFORT,
  FIXTURE_MODEL,
  type PreflightRepo,
  recordingOutput,
  removePreflightRepo,
} from "./helpers/preflightRepo.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";

// Telemetry off: `phax resume` would otherwise scaffold ~/.phax/telemetry.json.
vi.mock("../../src/app/loadTelemetryConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadTelemetryConfig.js")>();
  const effect = await import("effect");
  return { ...actual, loadTelemetryConfig: vi.fn(() => effect.Either.right({ enabled: false })) };
});

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

describe("executePlan — resume from startIndex: 1", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-test-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("continues from phase-02 and drives the run to review_open", async () => {
    const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan)).plan;

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
      publish: {
        auto: false,
        remote: "origin",
        provider: "github",
        pushBranch: true,
        createPullRequest: true,
      },
      complianceReview: { enabled: false, model: "claude-sonnet-5", effort: "medium" },
      codeReview: { model: "claude-opus-5-5", effort: "high" },
      authoring: {
        spec: { model: "claude-opus-5-5", effort: "high" },
        plan: { model: "claude-opus-5-5", effort: "high" },
      },
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
    };

    // Create run folder to establish run-status.json and registry entry.
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

    // Simulate phase-01 already completed: write committed status with worktreePath.
    const now = new Date().toISOString();
    const phase01FolderPath = join(runPath, "phase-01");
    await mkdir(phase01FolderPath, { recursive: true });
    await writeFile(
      join(phase01FolderPath, "status.json"),
      JSON.stringify(
        phaseStatusFile({
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
      ),
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

    // Advance run-status to "running" (as it would be after the run started).
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

    // Pre-create phase-02 worktree directory with the handoff file the agent would produce.
    const phase02WorktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-02");
    await mkdir(join(phase02WorktreePath, ".phax-context"), { recursive: true });
    await writeFile(
      join(phase02WorktreePath, ".phax-context", "phase-handoff.md"),
      HANDOFF_CONTENT,
    );

    const fakeGit = makeFakeGit();
    // phase-02 (final): dirty so commitPhase actually commits; cleanupPhase is skipped.
    fakeGit.impl.enqueueWorktreeIsClean(phase02WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "aabb1122\n",
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
      makeFakeGitHub().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: planMdFor(plan),
          config,
          gateProfileId: "full",
          allowDirty: true,
          runPath,
          runId,
          startIndex: 1,
        }).pipe(Effect.provide(resumeLayers)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const phase02Status = JSON.parse(
      await readFile(join(runPath, "phase-02", "status.json"), "utf8"),
    ) as { state: string; commitHash?: string };
    expect(phase02Status.state).toBe("review_open");
    expect(phase02Status.commitHash).toBe("aabb1122");

    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    expect(runStatus.state).toBe("review_open");

    const reviewHandoff = await readFile(join(runPath, "review-handoff.md"), "utf8");
    expect(reviewHandoff).toContain("my-run");

    const finalReport = await readFile(join(runPath, "final-report.md"), "utf8");
    expect(finalReport).toContain("my-run");
  });

  it("does not call prepareRunBranch when startIndex > 0", async () => {
    const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan)).plan;

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
      publish: {
        auto: false,
        remote: "origin",
        provider: "github",
        pushBranch: true,
        createPullRequest: true,
      },
      complianceReview: { enabled: false, model: "claude-sonnet-5", effort: "medium" },
      codeReview: { model: "claude-opus-5-5", effort: "high" },
      authoring: {
        spec: { model: "claude-opus-5-5", effort: "high" },
        plan: { model: "claude-opus-5-5", effort: "high" },
      },
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
    };

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

    const now = new Date().toISOString();
    const phase01FolderPath = join(runPath, "phase-01");
    await mkdir(phase01FolderPath, { recursive: true });
    await writeFile(
      join(phase01FolderPath, "status.json"),
      JSON.stringify(
        phaseStatusFile({
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
          commitHash: "aabbccdd",
        }),
      ),
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
    await mkdir(join(phase02WorktreePath, ".phax-context"), { recursive: true });
    await writeFile(
      join(phase02WorktreePath, ".phax-context", "phase-handoff.md"),
      HANDOFF_CONTENT,
    );

    const fakeGit = makeFakeGit();
    // Mark repo as NOT clean — if prepareRunBranch were called with allowDirty: false
    // it would fail. Resume always passes allowDirty: true, so isClean is not checked.
    fakeGit.impl.setRepoIsClean(false);
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
      makeFakeGitHub().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );

    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: planMdFor(plan),
          config,
          gateProfileId: "full",
          allowDirty: true,
          runPath,
          runId,
          startIndex: 1,
        }).pipe(Effect.provide(resumeLayers)),
      ),
    );

    // isClean was never called (no prepareRunBranch on resume)
    const isCleanCalls = fakeGit.impl.calls.filter((c) => c.method === "isClean");
    expect(isCleanCalls).toHaveLength(0);

    expect(Either.isRight(result)).toBe(true);
  });
});

describe("phax resume — a phax-plan.json an older phax wrote", () => {
  let roots: PreflightRepo | undefined;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(origCwd);
    removePreflightRepo(roots);
    roots = undefined;
  });

  /**
   * A two-phase run created with the real createRunFolder, paused after a
   * committed phase-01, whose phax-plan.json is then rewritten in the 0.17.0
   * shape: stamped 0.25.0, no phase carrying mode or oracle.
   */
  async function pauseWithOlderPlan(r: PreflightRepo): Promise<string> {
    const config = Either.getOrThrow(loadConfig(r.repo));
    const planMdPath = join(r.repo, "plan.md");
    const { plan } = await Effect.runPromise(
      loadOrExtractPlan({
        planMdPath,
        model: config.extractPlanModel,
        effort: config.extractPlanEffort,
        stateRoot: config.stateRoot,
        nowIso: new Date().toISOString(),
      }).pipe(Effect.provide(Layer.merge(NodeFileSystemLayer, makeFakeBackend().layer))),
    );
    const runShortName = Either.getOrThrow(decodeShortName(plan.run.shortName));
    const { runPath } = await Effect.runPromise(
      createRunFolder(runShortName, readFileSync(planMdPath, "utf8"), plan, config, "plan.md").pipe(
        Effect.provide(NodeFileSystemLayer),
      ),
    );

    const now = new Date().toISOString();
    const phase01 = join(runPath, "phase-01");
    await mkdir(phase01, { recursive: true });
    await writeFile(
      join(phase01, "status.json"),
      JSON.stringify(
        phaseStatusFile({
          phaseId: "phase-01",
          phaseIndex: 0,
          state: "committed",
          model: FIXTURE_MODEL,
          effort: FIXTURE_EFFORT,
          branchName: `${plan.run.branch}--phase-01`,
          base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          createdAt: now,
          updatedAt: now,
          worktreePath: join(r.stateRoot, "worktrees", `${r.namespace}.foo`, "phase-01"),
          commitHash: "aabbccdd11223344",
        }),
      ),
    );
    await writeFile(join(phase01, "phase-handoff.md"), HANDOFF_CONTENT);

    const statusPath = join(runPath, "run-status.json");
    const runStatus = JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      statusPath,
      JSON.stringify({
        ...runStatus,
        state: "interrupted",
        currentPhaseIndex: 1,
        gateProfileId: "standard",
        updatedAt: now,
      }),
    );
    await Effect.runPromise(
      setRunStatus(r.stateRoot, r.namespace, runShortName, { state: "interrupted" }).pipe(
        Effect.provide(NodeFileSystemLayer),
      ),
    );

    const planPath = join(runPath, "phax-plan.json");
    const written = JSON.parse(readFileSync(planPath, "utf8")) as {
      phases: Array<Record<string, unknown>>;
    };
    await writeFile(
      planPath,
      JSON.stringify({
        ...written,
        $schema: schemaUrl("phax-plan", "0.25.0"),
        phases: written.phases.map(({ mode: _mode, oracle: _oracle, ...phase }) => phase),
      }),
    );
    return runShortName;
  }

  it("exits 2 naming the file, its shape and the way out, with nothing written", async () => {
    const r = createPreflightRepo({ plan: { phases: [{}, {}] } });
    roots = r;
    process.chdir(r.repo);
    const runShortName = await pauseWithOlderPlan(r);
    const runPath = join(r.stateRoot, "runs", `${r.namespace}.${runShortName}`);
    const planPath = join(runPath, "phax-plan.json");
    const statusPath = join(runPath, "run-status.json");
    const planBefore = readFileSync(planPath, "utf8");
    const statusBefore = readFileSync(statusPath, "utf8");

    const out = recordingOutput();
    const code = await runResume(runShortName, { yes: true }, out.port);

    expect(code).toBe(2);
    expect(out.errors).toHaveLength(1);
    const [message] = out.errors;
    expect(message).toContain(planPath);
    expect(message).toContain("phax-plan in the 0.17.0 shape");
    expect(message).toContain("an older phax wrote it");
    expect(message).toContain("Finish the run with the phax release that started it");
    expect(message).toContain(`\`phax archive ${r.namespace}.${runShortName} --force\``);
    expect(message).toContain("run its plan again");
    expect(readFileSync(planPath, "utf8")).toBe(planBefore);
    expect(readFileSync(statusPath, "utf8")).toBe(statusBefore);
    expect(
      existsSync(join(r.stateRoot, "worktrees", `${r.namespace}.${runShortName}`, "phase-02")),
    ).toBe(false);
  });

  it("refuses on the preview too, never promising a resume it would refuse", async () => {
    const r = createPreflightRepo({ plan: { phases: [{}, {}] } });
    roots = r;
    process.chdir(r.repo);
    const runShortName = await pauseWithOlderPlan(r);

    const out = recordingOutput();
    const code = await runResume(runShortName, { yes: false }, out.port);

    expect(code).toBe(2);
    expect(out.errors.join("\n")).toContain("an older phax wrote it");
    expect(out.logs.join("\n")).not.toContain("would resume");
  });
});
