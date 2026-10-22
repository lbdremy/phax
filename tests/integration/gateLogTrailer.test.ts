import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import { decodeShortName } from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { FakeShellImpl, type FakeShellResponse } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { Shell, type ShellRunOptions } from "../../src/ports/shell.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import {
  resolveAuthoringConfig,
  resolveCodeReviewConfig,
  resolveComplianceReviewConfig,
  resolvePublishConfig,
  type ResolvedConfig,
} from "../../src/schemas/phaxConfig.js";
import { readPhaxPlanFile } from "../../src/schemas/persisted.js";
import { planMdFor } from "../helpers/planMarkdown.js";
import { phaseStatusFile } from "../helpers/phaseStatusFixture.js";

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

const GATE_COMMAND = "gate-check";
const PASS: FakeShellResponse = { exitCode: 0, stdout: "", stderr: "" };
const FAIL: FakeShellResponse = { exitCode: 1, stdout: "", stderr: "red" };

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
      plannedFilesToCreate: [],
      plannedFilesToEdit: [],
      optionalFilesToEdit: [],
      commit: { subject: "ai(phase-01): do thing", body: "Does the thing." },
    },
  ],
} as const;

/** A fake shell whose gate command answers from a script, one response per run. */
class ScriptedGateShell extends FakeShellImpl {
  constructor(private readonly gateResponses: FakeShellResponse[]) {
    super();
    this.setDefaultResponse(PASS);
    this.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
  }

  override run(options: ShellRunOptions) {
    if (options.command.join(" ") === GATE_COMMAND) {
      this.calls.push(options);
      return Effect.succeed({
        ...(this.gateResponses.shift() ?? PASS),
        stdoutEncoding: "utf8" as const,
      });
    }
    return super.run(options);
  }
}

function gateLogTrailer(body: string | undefined): string | undefined {
  return body?.split("\n").find((line) => line.startsWith("Gate-Log: "));
}

function resumeResponse(id: string) {
  return { sessionId: id as ClaudeSessionId, outputPath: "", finalText: "" };
}

describe("executePlan — the Gate-Log trailer", () => {
  let stateRoot: string;
  let worktreePath: string;

  const makeConfig = (maxFixAttempts: number): ResolvedConfig => ({
    raw: {
      version: 1,
      name: "test-project",
      state: { root: stateRoot },
      gateProfiles: {
        full: [{ command: GATE_COMMAND, surface: "local", firing: "every-phase", output: "log" }],
      },
      commands: { setup: ["true"], cleanup: ["true"] },
    },
    stateRoot,
    namespace: "test-project",
    repoRoot: stateRoot,
    maxFixAttempts,
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
  });

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-gate-log-"));
    worktreePath = join(stateRoot, "worktrees", "test-project.my-run", "phase-01");
    await mkdir(join(worktreePath, ".phax-context"), { recursive: true });
    await writeFile(join(worktreePath, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  /** Seeds a paused run with phase-01 left in `state`, and the given files in its folder. */
  async function seedPausedRun(opts: {
    runPath: string;
    runId: string;
    state: "gates_exhausted" | "passed";
    stoppedReason: "gates_exhausted" | "commit_failed";
    files: readonly string[];
  }): Promise<string> {
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
        stoppedReason: opts.stoppedReason,
        lastError: "paused",
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
          state: opts.state,
          model: "claude-sonnet-4-6",
          effort: "low",
          createdAt: now,
          updatedAt: now,
          branchName: "ai/my-run--phase-01",
          base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
          worktreePath,
          claudeSessionId: "sess-original",
        }),
      ),
    );
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
        sessionId: "sess-original",
        sessionHandle: null,
        worktreePath,
        cwd: worktreePath,
        launchedAt: now,
        status: "running",
      }),
    );
    for (const file of opts.files) {
      await writeFile(join(phaseFolder, file), "");
    }
    return phaseFolder;
  }

  async function run(opts: {
    config: ResolvedConfig;
    shell: ScriptedGateShell;
    backend: ReturnType<typeof makeFakeBackend>;
    seed?: (runPath: string, runId: string) => Promise<unknown>;
  }) {
    const plan = Either.getOrThrow(readPhaxPlanFile("phax-plan.json", rawPlan)).plan;
    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath, false);
    const layers = Layer.mergeAll(
      fakeGit.layer,
      Layer.succeed(Shell, opts.shell),
      opts.backend.layer,
      makeFakeGitHub().layer,
      NodeFileSystemLayer,
      NoopSystemTelemetryLayer,
    );
    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, planMdFor(plan), plan, opts.config).pipe(Effect.provide(layers)),
    );
    await opts.seed?.(runPath, runId);
    const result = await Effect.runPromise(
      Effect.either(
        executePlan({
          shortName,
          namespace: "test-project",
          plan,
          planMd: planMdFor(plan),
          config: opts.config,
          gateProfileId: "full",
          allowDirty: false,
          runPath,
          runId,
          startIndex: 0,
        }).pipe(Effect.provide(layers)),
      ),
    );
    const commits = fakeGit.impl.calls.flatMap((c) => (c.method === "commit" ? [c] : []));
    const runStatus = JSON.parse(await readFile(join(runPath, "run-status.json"), "utf8")) as {
      state: string;
    };
    return { result, commits, runStatus, phaseFolder: join(runPath, "phase-01") };
  }

  it("names the attempt that passed when the gate fails twice and passes on 03", async () => {
    const backend = makeFakeBackend();
    backend.impl.setAutoHandoffContent(HANDOFF_CONTENT);
    backend.impl.addRunResponse(resumeResponse("sess-01"));
    backend.impl.addResumeResponse(resumeResponse("sess-fix-01"));
    backend.impl.addResumeResponse(resumeResponse("sess-fix-02"));
    backend.impl.addResumeResponse(resumeResponse("sess-handoff"));

    const { result, commits, phaseFolder } = await run({
      config: makeConfig(2),
      shell: new ScriptedGateShell([FAIL, FAIL, PASS]),
      backend,
    });

    expect(Either.isRight(result)).toBe(true);
    expect(commits).toHaveLength(1);
    expect(gateLogTrailer(commits[0]?.body)).toBe(
      `Gate-Log: ${join(phaseFolder, "checks-attempt-03.log")}`,
    );
    expect(commits.some((c) => c.body.includes("checks-attempt-01.log"))).toBe(false);
  });

  it("names attempt 07 when a gate resume over attempts 01–06 passes first time", async () => {
    const backend = makeFakeBackend();
    backend.impl.setAutoHandoffContent(HANDOFF_CONTENT);
    backend.impl.addResumeResponse(resumeResponse("sess-handoff"));
    const priorAttempts = [1, 2, 3, 4, 5, 6].flatMap((n) => {
      const nn = String(n).padStart(2, "0");
      return [`checks-attempt-${nn}.log`, `fix-attempt-${nn}.jsonl`];
    });

    const { result, commits, phaseFolder } = await run({
      config: makeConfig(1),
      shell: new ScriptedGateShell([PASS]),
      backend,
      seed: (runPath, runId) =>
        seedPausedRun({
          runPath,
          runId,
          state: "gates_exhausted",
          stoppedReason: "gates_exhausted",
          files: priorAttempts,
        }),
    });

    expect(Either.isRight(result)).toBe(true);
    expect(backend.impl.runCalls).toHaveLength(0);
    expect(gateLogTrailer(commits[0]?.body)).toBe(
      `Gate-Log: ${join(phaseFolder, "checks-attempt-07.log")}`,
    );
  });

  it("names the highest recorded attempt on a commit-only resume, running no new attempt", async () => {
    const backend = makeFakeBackend();
    backend.impl.setAutoHandoffContent(HANDOFF_CONTENT);
    backend.impl.addResumeResponse(resumeResponse("sess-handoff"));
    const shell = new ScriptedGateShell([]);
    const files = ["checks-attempt-01.log", "fix-attempt-01.jsonl", "checks-attempt-02.log"];

    const { result, commits, phaseFolder } = await run({
      config: makeConfig(1),
      shell,
      backend,
      seed: (runPath, runId) =>
        seedPausedRun({
          runPath,
          runId,
          state: "passed",
          stoppedReason: "commit_failed",
          files,
        }),
    });

    expect(Either.isRight(result)).toBe(true);
    expect(gateLogTrailer(commits[0]?.body)).toBe(
      `Gate-Log: ${join(phaseFolder, "checks-attempt-02.log")}`,
    );
    expect(shell.calls.some((c) => c.command.join(" ") === GATE_COMMAND)).toBe(false);
    const attemptFiles = (await readdir(phaseFolder)).filter((name) =>
      /^(checks|fix)-attempt-/.test(name),
    );
    expect(attemptFiles.toSorted()).toEqual(files.toSorted());
  });

  it("writes `Gate-Log: none` on a commit-only resume with no recorded attempt, and goes on", async () => {
    const backend = makeFakeBackend();
    backend.impl.setAutoHandoffContent(HANDOFF_CONTENT);
    backend.impl.addResumeResponse(resumeResponse("sess-handoff"));

    const { result, commits, runStatus } = await run({
      config: makeConfig(1),
      shell: new ScriptedGateShell([]),
      backend,
      seed: (runPath, runId) =>
        seedPausedRun({
          runPath,
          runId,
          state: "passed",
          stoppedReason: "commit_failed",
          files: [],
        }),
    });

    expect(Either.isRight(result)).toBe(true);
    expect(commits).toHaveLength(1);
    expect(gateLogTrailer(commits[0]?.body)).toBe("Gate-Log: none");
    expect(runStatus.state).toBe("review_open");
  });
});
