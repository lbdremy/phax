import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { BranchName, PhaseId, RunId, WorktreePath } from "../../../src/domain/branded.js";
import type { PhaxEventBase } from "../../../src/domain/events.js";
import { AgentInvocationError, GateFailedError } from "../../../src/domain/errors.js";
import { Backend } from "../../../src/ports/backend.js";
import { SystemTelemetry } from "../../../src/ports/systemTelemetry.js";
import { makeFakeBackend } from "../../../src/infra/fakes/backend.js";
import { makeFakeFileSystem } from "../../../src/infra/fakes/fs.js";
import { makeFakeGit } from "../../../src/infra/fakes/git.js";
import { makeFakeShell } from "../../../src/infra/fakes/shell.js";
import { makeFakeSystemTelemetry } from "../../../src/infra/fakes/systemTelemetry.js";
import { adaptWorktreeCreate } from "../../../src/app/eventAdapter.js";
import { runGatesWithFixLoop } from "../../../src/app/fixLoop.js";
import { reportClaudeFailure } from "../../../src/app/telemetry/reportBuilders.js";
import type { ClaudeSessionId } from "../../../src/domain/branded.js";

const runId = "my-run" as RunId;
const phaseId = "phase-01" as PhaseId;
const worktreePath = "/runs/my-run/worktrees/phase-01" as WorktreePath;
const runPath = "/fake/runs/my-run";
const phaseFolderPath = `${runPath}/phase-01`;
const sessionId = "sess-abc123" as ClaudeSessionId;

const runStatusJson = JSON.stringify({
  version: 1,
  shortName: "my-run",
  runId: "my-run-2026-05-28",
  state: "running",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  phasesCount: 1,
  currentPhaseIndex: 0,
});

const phaseStatusJson = JSON.stringify({
  version: 1,
  phaseId: "phase-01",
  phaseIndex: 0,
  state: "running",
  model: "claude-sonnet-4-6",
  effort: "low",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  branchName: "ai/my-run--phase-01",
});

const base: PhaxEventBase = {
  eventId: "evt-1",
  occurredAt: new Date().toISOString(),
  run: runId,
  phase: phaseId,
};

// ─── Shell / gate adapter failure ─────────────────────────────────────────────

describe("shell adapter failure via runGatesWithFixLoop", () => {
  it("produces a SystemErrorReport with adapter=shell when a gate command fails", async () => {
    const { impl: telImpl, layer: telLayer } = makeFakeSystemTelemetry();
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    const fakeBackend = makeFakeBackend();
    const fakeGit = makeFakeGit();
    fakeFs.impl.setFile(`${phaseFolderPath}/status.json`, phaseStatusJson);
    fakeFs.impl.setFile(`${runPath}/run-status.json`, runStatusJson);
    fakeShell.impl.setDefaultResponse({ exitCode: 1, stdout: "", stderr: "test failure output" });

    const layer = Layer.mergeAll(
      fakeFs.layer,
      fakeShell.layer,
      fakeBackend.layer,
      fakeGit.layer,
      telLayer,
    );

    const result = await Effect.runPromise(
      Effect.either(
        runGatesWithFixLoop({
          commands: ["pnpm test"],
          cwd: "/fake/worktrees/phase-01",
          phaseFolderPath,
          sessionId,
          agentOptions: {
            provider: "claude-code" as const,
            model: "claude-sonnet-4-6",
            effort: "medium",
            cwd: "/fake/worktrees/phase-01",
            phaseFolderPath,
          },
          maxFixAttempts: 0,
          run: "my-run",
          phaseId: "phase-01",
          runPath,
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(GateFailedError);
    }

    const errors = telImpl.errors();
    expect(errors.length).toBeGreaterThanOrEqual(1);

    const gateError = errors.find((e) => e.adapter === "shell");
    expect(gateError).toBeDefined();
    expect(gateError!.adapter).toBe("shell");
    expect(gateError!.operation).toBe("gate.pnpm test");
    expect(gateError!.exitCode).toBe(1);
    expect(gateError!.stderrExcerpt).toBe("test failure output");
  });
});

// ─── Git adapter failure via adaptWorktreeCreate ──────────────────────────────

describe("git adapter failure via adaptWorktreeCreate", () => {
  it("produces a SystemErrorReport with adapter=git when worktree creation fails", async () => {
    const { impl: telImpl, layer: telLayer } = makeFakeSystemTelemetry();
    const fakeGit = makeFakeGit();

    fakeGit.impl.failNextWorktreeAdd("fatal: branch already checked out");

    const layer = Layer.merge(fakeGit.layer, telLayer);
    const branch = "my-run/phase-01" as BranchName;

    const result = await Effect.runPromise(
      Effect.either(
        adaptWorktreeCreate(branch, worktreePath, "/repos/myproject", base).pipe(
          Effect.provide(layer),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);

    const errors = telImpl.errors();
    expect(errors.length).toBeGreaterThanOrEqual(1);

    const gitError = errors.find((e) => e.adapter === "git");
    expect(gitError).toBeDefined();
    expect(gitError!.adapter).toBe("git");
    expect(gitError!.operation).toBe("worktree.create");
    expect(gitError!.runId).toBe(runId);
    expect(gitError!.stderrExcerpt).toBe("fatal: branch already checked out");
  });
});

// ─── Claude adapter failure ───────────────────────────────────────────────────

describe("claude adapter failure via FakeBackend + reportClaudeFailure", () => {
  it("produces a SystemErrorReport with adapter=claude-code-cli when invocation fails", async () => {
    const { impl: telImpl, layer: telLayer } = makeFakeSystemTelemetry();
    const fakeBackend = makeFakeBackend();

    const layer = Layer.merge(fakeBackend.layer, telLayer);

    await Effect.runPromise(
      Effect.gen(function* () {
        const backend = yield* Backend;
        const telemetry = yield* SystemTelemetry;

        const result = yield* Effect.either(
          backend.runAgent("prompt", {
            provider: "claude-code",
            model: "m",
            effort: "low",
            cwd: "/",
          }),
        );

        if (Either.isLeft(result)) {
          const e = result.left;
          if (e instanceof AgentInvocationError) {
            yield* telemetry.recordError(
              reportClaudeFailure(e, {
                runId,
                operationId: "phase-01",
                adapter: "claude-code-cli",
                operation: "agent.run",
              }),
            );
          }
        }
      }).pipe(Effect.provide(layer)),
    );

    const errors = telImpl.errors();
    expect(errors.length).toBe(1);
    expect(errors[0]!.adapter).toBe("claude-code-cli");
    expect(errors[0]!.operation).toBe("agent.run");
    expect(errors[0]!.type).toBe("adapter.claude_failed");
    expect(errors[0]!.runId).toBe(runId);
  });
});
