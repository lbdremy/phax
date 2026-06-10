import { Effect, Either, Layer } from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executePlan } from "../../src/app/executePlan.js";
import { createRunFolder } from "../../src/app/runFolder.js";
import {
  decodeClaudeSessionId,
  decodePhaseId,
  decodeRunId,
  decodeShortName,
  decodeWorktreePath,
} from "../../src/domain/branded.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { interpret } from "../../src/domain/reducer.js";
import type { PhaxState } from "../../src/domain/state.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../src/infra/fakes/systemTelemetry.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
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
const domainRunId = Either.getOrThrow(decodeRunId("run-1"));
const domainPhaseId = Either.getOrThrow(decodePhaseId("phase-01"));
const domainSessionId = Either.getOrThrow(decodeClaudeSessionId("session-1"));
const domainWorktreePath = Either.getOrThrow(decodeWorktreePath("/tmp/wt"));

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

describe("State Machine Contract", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "phax-contract-test-"));
    const phase01Worktree = join(stateRoot, "worktrees", "my-run", "phase-01");
    await mkdir(join(phase01Worktree, ".phax-context"), { recursive: true });
    await writeFile(join(phase01Worktree, ".phax-context", "phase-handoff.md"), HANDOFF_CONTENT);
  });

  it("contracts gate exhaustion pause and resume lift", () => {
    const state: PhaxState = {
      run: "running",
      phase: { state: "gates_failed", attempt: 3 },
    };
    const exhausted = interpret(state, {
      eventId: "evt-exhausted",
      occurredAt: "2026-05-20T12:00:00Z",
      run: domainRunId,
      phase: domainPhaseId,
      type: "FixAttemptsExhausted",
      attempt: 3,
      phaseId: domainPhaseId,
      worktreePath: domainWorktreePath,
      sessionId: domainSessionId,
      command: "pnpm test",
    });

    expect(exhausted.kind).toBe("Handled");
    if (exhausted.kind !== "Handled") return;
    expect(exhausted.nextState).toEqual({
      run: "interrupted",
      phase: { state: "gates_exhausted", attempt: 3 },
    });
    expect(exhausted.effects.map((effect) => effect.type)).toEqual([
      "PersistState",
      "WriteResumeInstructions",
      "EmitTrace",
      "EmitTrace",
    ]);

    const resumed = interpret(exhausted.nextState, {
      eventId: "evt-resume",
      occurredAt: "2026-05-20T12:01:00Z",
      run: domainRunId,
      type: "RunResumeRequested",
    });

    expect(resumed.kind).toBe("Handled");
    if (resumed.kind !== "Handled") return;
    expect(resumed.nextState).toEqual({ run: "running", phase: { state: "running" } });
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("snapshots the ordered semantic trace for a happy-path one-phase run", async () => {
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

    const phase01WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false);

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

    const fakeTelemetry = makeFakeSystemTelemetry();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      fakeTelemetry.layer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const result = await Effect.runPromise(
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

    expect(Either.isRight(result)).toBe(true);

    // Snapshot the semantic trace projection — the stable, transport-agnostic contract.
    const snapshot = fakeTelemetry.impl.getSemanticTraceSnapshot();
    expect(snapshot).toMatchSnapshot("happy-path-one-phase-semantic-trace");
  });

  it("snapshots the rate-limit pause semantic events", async () => {
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

    const phase01WorktreePath = join(stateRoot, "worktrees", "my-run", "phase-01");

    const fakeGit = makeFakeGit();
    fakeGit.impl.setRepoIsClean(true);
    fakeGit.impl.enqueueWorktreeIsClean(phase01WorktreePath, false);

    const fakeShell = makeFakeShell();
    fakeShell.impl.setResponse("true", { exitCode: 0, stdout: "", stderr: "" });
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef12345678\n",
      stderr: "",
    });
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });

    const fakeBackend = makeFakeBackend();
    // First run hits a rate limit during phase-01.
    fakeBackend.impl.failRunWithRateLimit(0, {
      kind: "rate_limit",
      resetAt: "2026-05-20T14:30:00Z",
    });

    const fakeTelemetry = makeFakeSystemTelemetry();

    const layers = Layer.mergeAll(
      fakeGit.layer,
      fakeShell.layer,
      fakeBackend.layer,
      NodeFileSystemLayer,
      fakeTelemetry.layer,
    );

    const { runPath, runId } = await Effect.runPromise(
      createRunFolder(shortName, "# My Plan", plan, config).pipe(Effect.provide(layers)),
    );

    const runResult = await Effect.runPromise(
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

    // Run should fail with rate limit.
    expect(Either.isLeft(runResult)).toBe(true);

    // The rate-limit path should produce an adapter.call.failed event and a
    // step.completed (resume.notify) event through the EmitTrace → semantic mapping.
    const telEvents = fakeTelemetry.impl.events();
    const rateLimitEvents = telEvents.filter(
      (e) =>
        (e.type === "adapter.call.failed" && "actual" in e && e.actual === "rate_limited") ||
        (e.type === "step.completed" && "step" in e && e.step === "resume.notify"),
    );
    expect(rateLimitEvents.length).toBeGreaterThanOrEqual(1);
  });
});
