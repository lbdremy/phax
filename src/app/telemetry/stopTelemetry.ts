// The effect telemetry of a stop, declared or held: its turns' provider
// calls, the closing gate (with its oracle step), the review commit and a
// held discharge's unjudged oracle edits, emitted as a headless phase's are
// (executePlan, fixLoop). The dispatcher traces the stop's state transitions.
import { Effect, Either } from "effect";
import type { RunId } from "../../domain/branded.js";
import {
  AgentInvocationError,
  GateFailedError,
  GateStepRefusedError,
} from "../../domain/errors.js";
import type { TranscriptOutcome } from "../../domain/interactive/transcripts.js";
import type { ProviderId } from "../../domain/routing/types.js";
import { makeSystemErrorReport } from "../../domain/telemetry/errors.js";
import {
  makeAdapterCallFailedTelemetryEvent,
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeGateEvaluatedTelemetryEvent,
  makeOracleEditsUnjudgedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeStepStartedTelemetryEvent,
  makeStopTranscriptTelemetryEvent,
} from "../../domain/telemetry/events.js";
import { GitError } from "../../ports/git.js";
import { SystemTelemetry } from "../../ports/systemTelemetry.js";
import { reportAgentFailure, reportGitFailure } from "./reportBuilders.js";

export interface StopTraceContext {
  readonly runId: string;
  readonly phaseId: string;
}

/** A turn's provider call: started, then succeeded, or its agent failure reported. */
export function tracedTurnCall<A, E, R>(
  ctx: StopTraceContext & {
    readonly provider: string;
    readonly operation: "agent.run" | "agent.resume";
  },
  call: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | SystemTelemetry> {
  return Effect.gen(function* () {
    const telemetry = yield* SystemTelemetry;
    const at = {
      runId: ctx.runId as RunId,
      operationId: ctx.phaseId,
      adapter: ctx.provider,
      operation: ctx.operation,
    };
    yield* telemetry.recordEvent(makeAdapterCallStartedTelemetryEvent(at));
    const result = yield* telemetry.withOperation(
      `phax.${ctx.provider}.${ctx.operation}`,
      { "phax.phase.id": ctx.phaseId },
      call.pipe(
        Effect.tapError((e) =>
          e instanceof AgentInvocationError
            ? telemetry.recordError(reportAgentFailure(e, at))
            : Effect.void,
        ),
      ),
    );
    yield* telemetry.recordEvent(makeAdapterCallSucceededTelemetryEvent(at));
    return result;
  });
}

/**
 * A step of the stop (`first-turn`, `closing-turn`): started, then completed
 * as a success when `succeeded` holds for its value, a failure otherwise or
 * when it fails.
 */
export function tracedStep<A, E, R>(
  ctx: StopTraceContext & { readonly step: string },
  step: Effect.Effect<A, E, R>,
  succeeded: (value: A) => boolean,
): Effect.Effect<A, E, R | SystemTelemetry> {
  return Effect.gen(function* () {
    const telemetry = yield* SystemTelemetry;
    const at = { runId: ctx.runId as RunId, operationId: ctx.phaseId, step: ctx.step };
    yield* telemetry.recordEvent(makeStepStartedTelemetryEvent(at));
    const outcome = yield* Effect.either(step);
    const ok = Either.isRight(outcome) && succeeded(outcome.right);
    yield* telemetry.recordEvent(
      makeStepCompletedTelemetryEvent({ ...at, result: ok ? "success" : "failure" }),
    );
    return yield* outcome;
  });
}

/** One recorded session's transcript at a close: captured, or missing with its reason. */
export function traceTranscript(
  ctx: StopTraceContext,
  session: { readonly sessionId: string; readonly provider: ProviderId },
  outcome: TranscriptOutcome,
): Effect.Effect<void, never, SystemTelemetry> {
  return Effect.gen(function* () {
    const telemetry = yield* SystemTelemetry;
    yield* telemetry.recordEvent(
      makeStopTranscriptTelemetryEvent({
        runId: ctx.runId as RunId,
        operationId: ctx.phaseId,
        sessionId: session.sessionId,
        provider: session.provider,
        outcome: outcome.status,
        ...(outcome.status === "missing" ? { reason: outcome.reason } : {}),
      }),
    );
  });
}

/** The closing gate: `gate.run` and its evaluation, and a failed step's report. */
export function tracedCloseGate<A, E, R>(
  ctx: StopTraceContext,
  gate: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | SystemTelemetry> {
  return Effect.gen(function* () {
    const telemetry = yield* SystemTelemetry;
    const runId = ctx.runId as RunId;
    const at = { runId, operationId: ctx.phaseId };
    yield* telemetry.recordEvent(makeStepStartedTelemetryEvent({ ...at, step: "gate.run" }));
    const outcome = yield* Effect.either(gate);
    if (Either.isRight(outcome)) {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({ ...at, step: "gate.run", result: "success" }),
      );
      yield* telemetry.recordEvent(
        makeGateEvaluatedTelemetryEvent({ ...at, gate: "checks", result: "accepted" }),
      );
      return outcome.right;
    }
    const error = outcome.left;
    yield* telemetry.recordEvent(
      makeStepCompletedTelemetryEvent({ ...at, step: "gate.run", result: "failure" }),
    );
    if (error instanceof GateStepRefusedError) {
      yield* telemetry.recordEvent(
        makeGateEvaluatedTelemetryEvent({
          ...at,
          gate: "checks",
          result: "rejected",
          reason: `refused: ${error.command}`,
        }),
      );
    } else if (error instanceof GateFailedError) {
      yield* telemetry.recordEvent(
        makeGateEvaluatedTelemetryEvent({
          ...at,
          gate: "checks",
          result: "rejected",
          reason: `exit ${error.exitCode}: ${error.command}`,
        }),
      );
      yield* telemetry.recordError(
        makeSystemErrorReport({
          type: "gate.failed",
          runId,
          operationId: ctx.phaseId,
          adapter: "shell",
          operation: `gate.${error.command}`,
          exitCode: error.exitCode,
          ...(error.stderrExcerpt !== undefined ? { stderrExcerpt: error.stderrExcerpt } : {}),
          cause: error,
        }),
      );
    }
    return yield* Effect.fail(error);
  });
}

/**
 * The oracle files a held discharge's corrections changed, which no oracle
 * step judges: one `oracle.edits.unjudged` event, and none when `files` is
 * empty.
 */
export function traceUnjudgedOracleEdits(
  ctx: StopTraceContext,
  files: readonly string[],
): Effect.Effect<void, never, SystemTelemetry> {
  return Effect.gen(function* () {
    if (files.length === 0) return;
    const telemetry = yield* SystemTelemetry;
    yield* telemetry.recordEvent(
      makeOracleEditsUnjudgedTelemetryEvent({
        runId: ctx.runId as RunId,
        operationId: ctx.phaseId,
        files,
      }),
    );
  });
}

/** The review commit: `git commit.create`, succeeded or failed with its git report. */
export function tracedReviewCommit<A, E, R>(
  ctx: StopTraceContext,
  commit: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | SystemTelemetry> {
  return Effect.gen(function* () {
    const telemetry = yield* SystemTelemetry;
    const at = {
      runId: ctx.runId as RunId,
      operationId: ctx.phaseId,
      adapter: "git",
      operation: "commit.create",
    };
    const outcome = yield* Effect.either(commit);
    if (Either.isRight(outcome)) {
      yield* telemetry.recordEvent(makeAdapterCallSucceededTelemetryEvent(at));
      return outcome.right;
    }
    const error = outcome.left;
    const reason = error instanceof Error ? error.message : String(error);
    yield* telemetry.recordEvent(
      makeAdapterCallFailedTelemetryEvent({
        ...at,
        exitCode: 1,
        stderrExcerpt: reason.slice(0, 500),
      }),
    );
    if (error instanceof GitError) yield* telemetry.recordError(reportGitFailure(error, at));
    return yield* Effect.fail(error);
  });
}
