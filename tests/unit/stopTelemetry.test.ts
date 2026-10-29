import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  tracedCloseGate,
  tracedReviewCommit,
  tracedStep,
  tracedTurnCall,
  traceTranscript,
} from "../../src/app/telemetry/stopTelemetry.js";
import {
  AgentInvocationError,
  GateFailedError,
  GateStepRefusedError,
} from "../../src/domain/errors.js";
import { sessionFailureError } from "../../src/domain/session/failureError.js";
import { makeInMemoryTelemetryLayer } from "../../src/infra/telemetry/inMemory.js";
import { GitError } from "../../src/ports/git.js";
import type { SystemTelemetry } from "../../src/ports/systemTelemetry.js";

const ctx = { runId: "invoice-export-1", phaseId: "phase-03" };

function traced<A, E>(effect: Effect.Effect<A, E, SystemTelemetry>) {
  const { impl, layer } = makeInMemoryTelemetryLayer();
  const result = Effect.runSync(Effect.either(effect.pipe(Effect.provide(layer))));
  return {
    result,
    events: impl.getSemanticTraceSnapshot(),
    errors: impl.errors().map((e) => e.type),
  };
}

describe("tracedTurnCall", () => {
  it("traces a provider call that answers as started then succeeded", () => {
    const { result, events, errors } = traced(
      tracedTurnCall(
        { ...ctx, provider: "claude-code", operation: "agent.run" },
        Effect.succeed("answer"),
      ),
    );
    expect(result).toEqual(Either.right("answer"));
    expect(events.map((e) => e["type"])).toEqual([
      "adapter.call.started",
      "adapter.call.succeeded",
    ]);
    expect(events[0]).toMatchObject({ adapter: "claude-code", operation: "agent.run" });
    expect(errors).toEqual([]);
  });

  it("reports an agent failure and records no success", () => {
    const failure = new AgentInvocationError({ message: "claude exited 1", exitCode: 1 });
    const { result, events, errors } = traced(
      tracedTurnCall(
        { ...ctx, provider: "claude-code", operation: "agent.resume" },
        Effect.fail(failure),
      ),
    );
    expect(result).toEqual(Either.left(failure));
    expect(events.map((e) => e["type"])).toEqual(["adapter.call.started"]);
    expect(errors).toEqual(["adapter.agent_failed"]);
  });
});

describe("tracedTurnCall on a failed session", () => {
  it("reports a session that lost the network once, as adapter.agent_failed", () => {
    const failure = sessionFailureError(
      {
        provider: "codex-cli",
        kind: "network",
        message: "stream disconnected before completion: error sending request",
        sessionId: "0199a7c2-5e3b-7d10-8f4a-2b6c9d1e0a37",
        resetAt: null,
      },
      { agentErrorLog: "/runs/r/phase-03/agent-error.log", transcript: null },
    );
    const { impl, layer } = makeInMemoryTelemetryLayer();
    Effect.runSync(
      Effect.either(
        tracedTurnCall(
          { ...ctx, provider: "codex-cli", operation: "agent.resume" },
          Effect.fail(failure),
        ).pipe(Effect.provide(layer)),
      ),
    );
    const reports = impl.errors();
    expect(reports.map((e) => e.type)).toEqual(["adapter.agent_failed"]);
    expect(reports[0]).toMatchObject({ adapter: "codex-cli", actual: "network" });
  });
});

describe("tracedStep", () => {
  it("completes as a failure when the step's value is not a success", () => {
    const { events } = traced(
      tracedStep(
        { ...ctx, step: "first-turn" },
        Effect.succeed({ kind: "failed" }),
        (a) => a.kind === "answered",
      ),
    );
    expect(events).toEqual([
      { type: "step.started", operationId: "phase-03", step: "first-turn" },
      { type: "step.completed", operationId: "phase-03", step: "first-turn", result: "failure" },
    ]);
  });

  it("completes as a failure, then fails, when the step fails", () => {
    const { result, events } = traced(
      tracedStep({ ...ctx, step: "closing-turn" }, Effect.fail("interrupted"), () => true),
    );
    expect(result).toEqual(Either.left("interrupted"));
    expect(events.at(-1)).toMatchObject({ step: "closing-turn", result: "failure" });
  });
});

describe("traceTranscript", () => {
  it("records one stop.transcript event per session, captured or missing with its reason", () => {
    const session = { sessionId: "X1", provider: "codex-cli" } as const;
    const { events } = traced(
      Effect.gen(function* () {
        yield* traceTranscript(ctx, session, { status: "captured", sha256: "a".repeat(64) });
        yield* traceTranscript(ctx, session, {
          status: "missing",
          reason: "unreadable",
          detail: "permission denied",
        });
      }),
    );
    expect(events).toEqual([
      {
        type: "stop.transcript",
        operationId: "phase-03",
        sessionId: "X1",
        provider: "codex-cli",
        outcome: "captured",
      },
      {
        type: "stop.transcript",
        operationId: "phase-03",
        sessionId: "X1",
        provider: "codex-cli",
        outcome: "missing",
        reason: "unreadable",
      },
    ]);
  });
});

describe("tracedCloseGate", () => {
  it("evaluates a red gate as rejected and reports gate.failed", () => {
    const failure = new GateFailedError({
      message: "pnpm typecheck failed",
      command: "pnpm typecheck",
      exitCode: 2,
      logPath: "/runs/invoice-export/phase-03/checks-attempt-01.log",
      reportFindings: null,
      failedStep: "configured",
    });
    const { result, events, errors } = traced(tracedCloseGate(ctx, Effect.fail(failure)));
    expect(result).toEqual(Either.left(failure));
    expect(events).toEqual([
      { type: "step.started", operationId: "phase-03", step: "gate.run" },
      { type: "step.completed", operationId: "phase-03", step: "gate.run", result: "failure" },
      {
        type: "gate.evaluated",
        operationId: "phase-03",
        gate: "checks",
        result: "rejected",
        reason: "exit 2: pnpm typecheck",
      },
    ]);
    expect(errors).toEqual(["gate.failed"]);
  });

  it("evaluates a refused step as rejected without a gate.failed report", () => {
    const refusal = new GateStepRefusedError({
      message: "refused",
      command: "pnpm lint",
      exitCode: 1,
      logPath: "/runs/invoice-export/phase-03/checks-attempt-01.log",
      reason: "made-up refusal",
      remedy: "made-up remedy",
      phaseId: "phase-03",
      failedStep: "configured",
    });
    const { events, errors } = traced(tracedCloseGate(ctx, Effect.fail(refusal)));
    expect(events.at(-1)).toMatchObject({ result: "rejected", reason: "refused: pnpm lint" });
    expect(errors).toEqual([]);
  });

  it("evaluates a green gate as accepted", () => {
    const { events } = traced(tracedCloseGate(ctx, Effect.succeed({ steps: [] })));
    expect(events.map((e) => e["type"])).toEqual([
      "step.started",
      "step.completed",
      "gate.evaluated",
    ]);
    expect(events.at(-1)).toMatchObject({ result: "accepted" });
  });
});

describe("tracedReviewCommit", () => {
  it("records commit.create as succeeded", () => {
    const { events } = traced(tracedReviewCommit(ctx, Effect.succeed("abc")));
    expect(events).toEqual([
      {
        type: "adapter.call.succeeded",
        operationId: "phase-03",
        adapter: "git",
        operation: "commit.create",
      },
    ]);
  });

  // The projection drops the exit code and the stderr excerpt.
  it("records a failed commit and reports the git failure", () => {
    const failure = new GitError({ message: "pre-commit hook failed", command: "git commit" });
    const { result, events, errors } = traced(tracedReviewCommit(ctx, Effect.fail(failure)));
    expect(result).toEqual(Either.left(failure));
    expect(events).toEqual([
      {
        type: "adapter.call.failed",
        operationId: "phase-03",
        adapter: "git",
        operation: "commit.create",
      },
    ]);
    expect(errors).toEqual(["adapter.git_failed"]);
  });
});
