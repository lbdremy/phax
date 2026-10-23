import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  tracedCloseGate,
  tracedReviewCommit,
  tracedStep,
  tracedTurnCall,
} from "../../src/app/telemetry/stopTelemetry.js";
import {
  AgentInvocationError,
  GateFailedError,
  GateStepRefusedError,
} from "../../src/domain/errors.js";
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
