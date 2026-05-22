import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { BranchName, PhaseId, RunId, WorktreePath } from "../../src/domain/branded.js";
import type { PhaxEventBase } from "../../src/domain/events.js";
import { ClaudeInvocationError, RateLimitError } from "../../src/domain/errors.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { makeFakeTracer } from "../../src/infra/fakes/tracer.js";
import {
  adaptAgentRun,
  adaptAgentResume,
  adaptCleanup,
  adaptCommit,
  adaptGateRun,
  adaptHandoffGenerate,
  adaptWorktreeCreate,
} from "../../src/app/eventAdapter.js";
import type { CommitPhaseOptions } from "../../src/app/commit.js";
import type { CleanupPhaseOptions } from "../../src/app/cleanup.js";
import type { GenerateHandoffOptions } from "../../src/app/handoffGeneration.js";

const runId = "my-run" as RunId;
const phaseId = "phase-01" as PhaseId;
const worktreePath = "/runs/my-run/worktrees/phase-01" as WorktreePath;
const runPath = "/runs/my-run";
const phaseFolderPath = `${runPath}/phase-01`;

const runStatusSeed = JSON.stringify({
  version: 1,
  shortName: "my-run",
  runId: "my-run-2026-05-21",
  state: "running",
  createdAt: "2026-05-21T00:00:00.000Z",
  updatedAt: "2026-05-21T00:00:00.000Z",
  phasesCount: 1,
  currentPhaseIndex: 0,
});

const base: PhaxEventBase = {
  eventId: "evt-1",
  occurredAt: "2026-05-21T00:00:00.000Z",
  run: runId,
  phase: phaseId,
};

const phaseStatusSeed = JSON.stringify({
  version: 1,
  phaseId: "phase-01",
  phaseIndex: 0,
  model: "claude-sonnet-4-6",
  effort: "low",
  state: "passed",
  createdAt: "2026-05-21T00:00:00.000Z",
  updatedAt: "2026-05-21T00:00:00.000Z",
});

// ─── adaptAgentRun ────────────────────────────────────────────────────────────

describe("adaptAgentRun", () => {
  it("success → AgentInvocationCompleted", async () => {
    const { impl, layer } = makeFakeBackend();
    impl.addRunResponse({
      sessionId: "sess-abc" as never,
      outputPath: "/out.jsonl",
      finalText: "",
    });

    const event = await Effect.runPromise(
      adaptAgentRun("prompt", { model: "m", effort: "low", cwd: "/" }, base).pipe(
        Effect.provide(layer),
      ),
    );

    expect(event.type).toBe("AgentInvocationCompleted");
    if (event.type === "AgentInvocationCompleted") {
      expect(event.sessionId).toBe("sess-abc");
      expect(event.eventId).toBe("evt-1");
    }
  });

  it("RateLimitError → RateLimitDetected with kind=rate_limit", async () => {
    const { impl, layer } = makeFakeBackend();
    impl.failRunWithRateLimit(0, { kind: "rate_limit", resetAt: "2026-05-21T01:00:00.000Z" });

    const event = await Effect.runPromise(
      adaptAgentRun("prompt", { model: "m", effort: "low", cwd: "/" }, base).pipe(
        Effect.provide(layer),
      ),
    );

    expect(event.type).toBe("RateLimitDetected");
    if (event.type === "RateLimitDetected") {
      expect(event.kind).toBe("rate_limit");
      expect(event.resetAt).toBe("2026-05-21T01:00:00.000Z");
      expect(event.cause).toBeInstanceOf(RateLimitError);
    }
  });

  it("UsageLimitError → RateLimitDetected with kind=usage_limit", async () => {
    const { impl, layer } = makeFakeBackend();
    impl.failRunWithRateLimit(0, { kind: "usage_limit" });

    const event = await Effect.runPromise(
      adaptAgentRun("prompt", { model: "m", effort: "low", cwd: "/" }, base).pipe(
        Effect.provide(layer),
      ),
    );

    expect(event.type).toBe("RateLimitDetected");
    if (event.type === "RateLimitDetected") {
      expect(event.kind).toBe("usage_limit");
    }
  });

  it("ClaudeInvocationError bubbles as Effect failure", async () => {
    const { layer } = makeFakeBackend();
    // no responses queued → ClaudeInvocationError

    const result = await Effect.runPromise(
      Effect.either(
        adaptAgentRun("prompt", { model: "m", effort: "low", cwd: "/" }, base).pipe(
          Effect.provide(layer),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ClaudeInvocationError);
    }
  });
});

// ─── adaptAgentResume ─────────────────────────────────────────────────────────

describe("adaptAgentResume", () => {
  const sessionId = "sess-xyz" as never;

  it("success → AgentInvocationCompleted", async () => {
    const { impl, layer } = makeFakeBackend();
    impl.addResumeResponse({
      sessionId: "sess-new" as never,
      outputPath: "/out.jsonl",
      finalText: "",
    });

    const event = await Effect.runPromise(
      adaptAgentResume(sessionId, "prompt", { model: "m", effort: "low", cwd: "/" }, base).pipe(
        Effect.provide(layer),
      ),
    );

    expect(event.type).toBe("AgentInvocationCompleted");
    if (event.type === "AgentInvocationCompleted") {
      expect(event.sessionId).toBe("sess-new");
    }
  });

  it("RateLimitError → RateLimitDetected", async () => {
    const { impl, layer } = makeFakeBackend();
    impl.failNextResumeWithRateLimit({ kind: "rate_limit", resetAt: "2026-05-21T02:00:00.000Z" });

    const event = await Effect.runPromise(
      adaptAgentResume(sessionId, "prompt", { model: "m", effort: "low", cwd: "/" }, base).pipe(
        Effect.provide(layer),
      ),
    );

    expect(event.type).toBe("RateLimitDetected");
    if (event.type === "RateLimitDetected") {
      expect(event.kind).toBe("rate_limit");
      expect(event.resetAt).toBe("2026-05-21T02:00:00.000Z");
    }
  });

  it("UsageLimitError → RateLimitDetected with kind=usage_limit", async () => {
    const { impl, layer } = makeFakeBackend();
    impl.failNextResumeWithRateLimit({ kind: "usage_limit" });

    const event = await Effect.runPromise(
      adaptAgentResume(sessionId, "prompt", { model: "m", effort: "low", cwd: "/" }, base).pipe(
        Effect.provide(layer),
      ),
    );

    expect(event.type).toBe("RateLimitDetected");
    if (event.type === "RateLimitDetected") {
      expect(event.kind).toBe("usage_limit");
    }
  });

  it("ClaudeInvocationError bubbles", async () => {
    const { layer } = makeFakeBackend();

    const result = await Effect.runPromise(
      Effect.either(
        adaptAgentResume(sessionId, "prompt", { model: "m", effort: "low", cwd: "/" }, base).pipe(
          Effect.provide(layer),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ClaudeInvocationError);
    }
  });
});

// ─── adaptGateRun ─────────────────────────────────────────────────────────────

describe("adaptGateRun", () => {
  const gateCommands = ["pnpm typecheck"];
  const cwd = worktreePath as string;
  const logPath = `${phaseFolderPath}/checks-attempt-01.log`;

  it("all gates pass → GatePassed", async () => {
    const fakeShell = makeFakeShell();
    const fakeFs = makeFakeFileSystem();
    const layer = Layer.mergeAll(fakeShell.layer, fakeFs.layer);

    const event = await Effect.runPromise(
      adaptGateRun(gateCommands, cwd, logPath, 1, base).pipe(Effect.provide(layer)),
    );

    expect(event.type).toBe("GatePassed");
    if (event.type === "GatePassed") {
      expect(event.attempt).toBe(1);
      expect(event.eventId).toBe("evt-1");
    }
  });

  it("gate fails → GateFailed with command/exitCode/logPath", async () => {
    const fakeShell = makeFakeShell();
    const fakeFs = makeFakeFileSystem();
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "type error" });
    const layer = Layer.mergeAll(fakeShell.layer, fakeFs.layer);

    const event = await Effect.runPromise(
      adaptGateRun(gateCommands, cwd, logPath, 2, base).pipe(Effect.provide(layer)),
    );

    expect(event.type).toBe("GateFailed");
    if (event.type === "GateFailed") {
      expect(event.command).toBe("pnpm typecheck");
      expect(event.exitCode).toBe(1);
      expect(event.logPath).toBe(logPath);
      expect(event.attempt).toBe(2);
    }
  });
});

// ─── adaptCommit ──────────────────────────────────────────────────────────────

describe("adaptCommit", () => {
  const commitOpts: CommitPhaseOptions = {
    phase: {
      id: phaseId,
      title: "Phase 01",
      model: "claude-sonnet-4-6",
      effort: "low",
      commit: { subject: "feat: phase-01", body: "Phase 01 work" },
    } as never,
    worktreePath,
    phaseFolderPath,
    runId: runId as string,
    shortName: "my-run",
    sessionId: "sess-abc" as never,
    gateLogPath: `${phaseFolderPath}/checks-attempt-01.log`,
    repoRoot: runPath,
    runPath,
  };

  it("changes present → CommitCreated with hash", async () => {
    const fakeGit = makeFakeGit();
    const fakeShell = makeFakeShell();
    const fakeFs = makeFakeFileSystem();
    const fakeTracer = makeFakeTracer();

    // worktreeIsClean returns false → changes present
    fakeGit.impl.enqueueWorktreeIsClean(worktreePath as string, false);
    // git rev-parse HEAD returns hash
    fakeShell.impl.setResponse("git rev-parse HEAD", {
      exitCode: 0,
      stdout: "deadbeef\n",
      stderr: "",
    });
    // git diff HEAD^ HEAD returns empty diff
    fakeShell.impl.setResponse("git diff HEAD^ HEAD", { exitCode: 0, stdout: "", stderr: "" });
    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, phaseStatusSeed);
    fakeFs.impl.setFile(`${runPath}/run-status.json`, runStatusSeed);

    const layer = Layer.mergeAll(fakeGit.layer, fakeShell.layer, fakeFs.layer, fakeTracer.layer);

    const event = await Effect.runPromise(
      adaptCommit(commitOpts, base).pipe(Effect.provide(layer)),
    );

    expect(event?.type).toBe("CommitCreated");
    if (event?.type === "CommitCreated") {
      expect(event.hash).toBe("deadbeef");
    }
  });

  it("no changes (worktree clean) → null", async () => {
    const fakeGit = makeFakeGit();
    const fakeShell = makeFakeShell();
    const fakeFs = makeFakeFileSystem();
    const fakeTracer = makeFakeTracer();

    fakeGit.impl.enqueueWorktreeIsClean(worktreePath as string, true);
    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, phaseStatusSeed);
    fakeFs.impl.setFile(`${runPath}/run-status.json`, runStatusSeed);

    const layer = Layer.mergeAll(fakeGit.layer, fakeShell.layer, fakeFs.layer, fakeTracer.layer);

    const event = await Effect.runPromise(
      adaptCommit(commitOpts, base).pipe(Effect.provide(layer)),
    );

    expect(event).toBeNull();
  });
});

// ─── adaptCleanup ─────────────────────────────────────────────────────────────

describe("adaptCleanup", () => {
  const baseCleanupOpts: CleanupPhaseOptions = {
    worktreePath,
    phaseFolderPath,
    cleanupCommands: [],
    repoRoot: runPath,
    isFinalPhase: false,
    runPath,
    shortName: "my-run",
    phaseId: phaseId as string,
  };

  // Cleanup transitions phase committed → cleaning_up → cleaned_up via dispatch.
  const committedPhaseSeed = JSON.stringify({
    version: 1,
    phaseId: "phase-01",
    phaseIndex: 0,
    model: "claude-sonnet-4-6",
    effort: "low",
    state: "committed",
    commitHash: "deadbeef",
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
  });

  it("non-final phase, clean worktree → CleanupCompleted", async () => {
    const fakeGit = makeFakeGit();
    const fakeShell = makeFakeShell();
    const fakeFs = makeFakeFileSystem();
    const fakeTracer = makeFakeTracer();

    fakeGit.impl.enqueueWorktreeIsClean(worktreePath as string, true);
    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, committedPhaseSeed);
    fakeFs.impl.setFile(`${runPath}/run-status.json`, runStatusSeed);

    const layer = Layer.mergeAll(fakeGit.layer, fakeShell.layer, fakeFs.layer, fakeTracer.layer);

    const event = await Effect.runPromise(
      adaptCleanup(baseCleanupOpts, base).pipe(Effect.provide(layer)),
    );

    expect(event?.type).toBe("CleanupCompleted");
    expect(event?.eventId).toBe("evt-1");
  });

  it("isFinalPhase=true → null without calling cleanupPhase", async () => {
    const fakeGit = makeFakeGit();
    const fakeShell = makeFakeShell();
    const fakeFs = makeFakeFileSystem();
    const fakeTracer = makeFakeTracer();
    const layer = Layer.mergeAll(fakeGit.layer, fakeShell.layer, fakeFs.layer, fakeTracer.layer);

    const event = await Effect.runPromise(
      adaptCleanup({ ...baseCleanupOpts, isFinalPhase: true }, base).pipe(Effect.provide(layer)),
    );

    expect(event).toBeNull();
    // No git or shell calls made
    expect(fakeGit.impl.calls).toHaveLength(0);
  });
});

// ─── adaptHandoffGenerate ─────────────────────────────────────────────────────

describe("adaptHandoffGenerate", () => {
  const handoffOpts: GenerateHandoffOptions = {
    sessionId: "sess-abc" as never,
    agentOptions: { model: "claude-sonnet-4-6", effort: "low", cwd: worktreePath as string },
    phaseFolderPath,
    worktreePath: worktreePath as string,
    runPath,
    shortName: "my-run",
    phaseId: phaseId as string,
  };

  // For HandoffMissing dispatch the reducer needs the phase in `passed`.
  const passedPhaseSeed = JSON.stringify({
    version: 1,
    phaseId: "phase-01",
    phaseIndex: 0,
    model: "claude-sonnet-4-6",
    effort: "low",
    state: "passed",
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
  });

  const handoffLayers = () => {
    const fakeBackend = makeFakeBackend();
    const fakeFs = makeFakeFileSystem();
    const fakeGit = makeFakeGit();
    const fakeShell = makeFakeShell();
    const fakeTracer = makeFakeTracer();
    const layer = Layer.mergeAll(
      fakeBackend.layer,
      fakeFs.layer,
      fakeGit.layer,
      fakeShell.layer,
      fakeTracer.layer,
    );
    return { fakeBackend, fakeFs, fakeGit, fakeShell, fakeTracer, layer };
  };

  it("valid handoff file → HandoffValidated", async () => {
    const { fakeBackend, fakeFs, layer } = handoffLayers();

    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-abc" as never,
      outputPath: "/out.jsonl",
      finalText: "",
    });
    fakeFs.impl.setFile(
      `${worktreePath as string}/phase-handoff.md`,
      [
        "## What was delivered",
        "## Key decisions and why",
        "## Exact locations (file paths and exported names)",
        "## What the next phase needs to know",
      ].join("\n"),
    );

    const event = await Effect.runPromise(
      adaptHandoffGenerate(handoffOpts, base).pipe(Effect.provide(layer)),
    );

    expect(event.type).toBe("HandoffValidated");
  });

  it("handoff file missing → HandoffMissing with all sections", async () => {
    const { fakeBackend, fakeFs, layer } = handoffLayers();

    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-abc" as never,
      outputPath: "/out.jsonl",
      finalText: "",
    });
    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, passedPhaseSeed);
    fakeFs.impl.setFile(`${runPath}/run-status.json`, runStatusSeed);
    // handoff file NOT created

    const event = await Effect.runPromise(
      adaptHandoffGenerate(handoffOpts, base).pipe(Effect.provide(layer)),
    );

    expect(event.type).toBe("HandoffMissing");
    if (event.type === "HandoffMissing") {
      expect(event.missingSections).toHaveLength(4);
    }
  });

  it("handoff file has missing sections → HandoffMissing", async () => {
    const { fakeBackend, fakeFs, layer } = handoffLayers();

    fakeBackend.impl.addResumeResponse({
      sessionId: "sess-abc" as never,
      outputPath: "/out.jsonl",
      finalText: "",
    });
    fakeFs.impl.setFile(
      `${worktreePath as string}/phase-handoff.md`,
      "## What was delivered\nsome content",
    );
    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, passedPhaseSeed);
    fakeFs.impl.setFile(`${runPath}/run-status.json`, runStatusSeed);

    const event = await Effect.runPromise(
      adaptHandoffGenerate(handoffOpts, base).pipe(Effect.provide(layer)),
    );

    expect(event.type).toBe("HandoffMissing");
    if (event.type === "HandoffMissing") {
      expect(event.missingSections).toContain("## Key decisions and why");
      expect(event.missingSections).not.toContain("## What was delivered");
    }
  });

  it("RateLimitError during backend call → RateLimitDetected", async () => {
    const { fakeBackend, layer } = handoffLayers();

    fakeBackend.impl.failNextResumeWithRateLimit({
      kind: "rate_limit",
      resetAt: "2026-05-21T03:00:00.000Z",
    });

    const event = await Effect.runPromise(
      adaptHandoffGenerate(handoffOpts, base).pipe(Effect.provide(layer)),
    );

    expect(event.type).toBe("RateLimitDetected");
    if (event.type === "RateLimitDetected") {
      expect(event.kind).toBe("rate_limit");
      expect(event.resetAt).toBe("2026-05-21T03:00:00.000Z");
      expect(event.cause).toBeInstanceOf(RateLimitError);
    }
  });

  it("ClaudeInvocationError bubbles", async () => {
    const { layer } = handoffLayers();
    // no resume response queued → ClaudeInvocationError

    const result = await Effect.runPromise(
      Effect.either(adaptHandoffGenerate(handoffOpts, base).pipe(Effect.provide(layer))),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ClaudeInvocationError);
    }
  });
});

// ─── adaptWorktreeCreate ──────────────────────────────────────────────────────

describe("adaptWorktreeCreate", () => {
  it("success → WorktreeCreated with path", async () => {
    const { layer } = makeFakeGit();
    const branch = "my-run/phase-01" as BranchName;
    const repoRoot = "/repos/myproject";

    const event = await Effect.runPromise(
      adaptWorktreeCreate(branch, worktreePath, repoRoot, base).pipe(Effect.provide(layer)),
    );

    expect(event.type).toBe("WorktreeCreated");
    if (event.type === "WorktreeCreated") {
      expect(event.path).toBe(worktreePath);
      expect(event.eventId).toBe("evt-1");
    }
  });
});
