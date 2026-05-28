import { Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ClaudeSessionId, PhaseId, RunId } from "../domain/branded.js";
import {
  type ClaudeInvocationError,
  type ClaudeSessionIdMissingError,
  GateFailedError,
  type RateLimitError,
  type RegistryCorruptionError,
  type SetupCommandFailedError,
  type UsageLimitError,
} from "../domain/errors.js";
import type { PhaxEvent, PhaxEventBase } from "../domain/events.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { Tracer } from "../ports/tracer.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import {
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeGateEvaluatedTelemetryEvent,
} from "../domain/telemetry/events.js";
import { dispatch } from "./dispatcher.js";
import { runGates, type GateOutcome } from "./gates.js";

function buildFixPrompt(gateError: GateFailedError, logContent: string, attempt: number): string {
  return [
    "# Gate checks failed — fix required",
    "",
    `Gate run (attempt ${attempt}) failed.`,
    "",
    `**Failed command:** \`${gateError.command}\``,
    `**Exit code:** ${gateError.exitCode}`,
    "",
    "## Gate output",
    "",
    "```",
    logContent,
    "```",
    "",
    "## Required action",
    "",
    "Fix all issues revealed by the gate output above.",
    "Make the minimum changes required to pass the gate.",
    "Do not change unrelated code or introduce new features.",
    "",
    "The gate run will be re-attempted automatically after your changes.",
  ].join("\n");
}

export interface RunGatesWithFixLoopOptions {
  readonly commands: readonly string[];
  readonly cwd: string;
  readonly phaseFolderPath: string;
  readonly sessionId: ClaudeSessionId;
  readonly agentOptions: AgentRunOptions;
  readonly maxFixAttempts: number;
  /** Run short name, for trace events. */
  readonly run: string;
  /** Current phase id, for trace events. */
  readonly phaseId: string;
  /** Run folder; the dispatcher reads run-status.json from here. */
  readonly runPath: string;
}

export function runGatesWithFixLoop(
  opts: RunGatesWithFixLoopOptions,
): Effect.Effect<
  GateOutcome,
  | GateFailedError
  | FsError
  | ShellError
  | GitError
  | SetupCommandFailedError
  | ClaudeInvocationError
  | ClaudeSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | RegistryCorruptionError,
  Shell | FileSystem | Backend | Git | Tracer | SystemTelemetry
> {
  const {
    commands,
    cwd,
    phaseFolderPath,
    sessionId,
    agentOptions,
    maxFixAttempts,
    run,
    phaseId,
    runPath,
  } = opts;

  const dispatchCtx = {
    runPath,
    shortName: run,
    phaseFolderPath,
    phaseId,
  } as const;

  function eventBase(): PhaxEventBase {
    return {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      run: run as RunId,
      phase: phaseId as PhaseId,
    };
  }

  function logPath(attempt: number): string {
    return join(phaseFolderPath, `checks-attempt-${String(attempt).padStart(2, "0")}.log`);
  }

  function loop(
    attempt: number,
    currentSessionId: ClaudeSessionId,
  ): Effect.Effect<
    GateOutcome,
    | GateFailedError
    | FsError
    | ShellError
    | GitError
    | SetupCommandFailedError
    | ClaudeInvocationError
    | ClaudeSessionIdMissingError
    | RateLimitError
    | UsageLimitError
    | RegistryCorruptionError,
    Shell | FileSystem | Backend | Git | Tracer | SystemTelemetry
  > {
    return Effect.gen(function* () {
      const tracer = yield* Tracer;
      const telemetry = yield* SystemTelemetry;
      const runId = run as unknown as RunId;
      const emit = (
        event: "gate.started" | "gate.completed" | "gate.failed" | "fix.started" | "fix.completed",
        status: "ok" | "failed" | "info",
        details?: Record<string, unknown>,
      ): Effect.Effect<void, never, never> =>
        tracer.event({
          timestamp: new Date().toISOString(),
          run,
          phase: phaseId,
          event,
          boundary: "gate",
          status,
          details,
        });

      yield* emit("gate.started", "info", { attempt });
      yield* telemetry.recordEvent(
        makeStepStartedTelemetryEvent({ runId, operationId: phaseId, step: `gate.run` }),
      );
      const gateResult = yield* Effect.either(runGates(commands, cwd, logPath(attempt)));

      if (Either.isRight(gateResult)) {
        yield* emit("gate.completed", "ok", { attempt });
        yield* telemetry.recordEvent(
          makeStepCompletedTelemetryEvent({
            runId,
            operationId: phaseId,
            step: `gate.run`,
            result: "success",
          }),
        );
        yield* telemetry.recordEvent(
          makeGateEvaluatedTelemetryEvent({
            runId,
            operationId: phaseId,
            gate: "checks",
            result: "accepted",
          }),
        );
        const gatePassedEvent: PhaxEvent = {
          ...eventBase(),
          type: "GatePassed",
          attempt,
        };
        yield* dispatch(gatePassedEvent, dispatchCtx);
        return gateResult.right;
      }

      const error = gateResult.left;

      if (!(error instanceof GateFailedError)) {
        return yield* Effect.fail(error);
      }

      yield* emit("gate.failed", "failed", {
        attempt,
        command: error.command,
        exitCode: error.exitCode,
      });
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: phaseId,
          step: `gate.run`,
          result: "failure",
        }),
      );
      yield* telemetry.recordEvent(
        makeGateEvaluatedTelemetryEvent({
          runId,
          operationId: phaseId,
          gate: "checks",
          result: "rejected",
          reason: `exit ${error.exitCode}: ${error.command}`,
        }),
      );

      const gateFailedEvent: PhaxEvent = {
        ...eventBase(),
        type: "GateFailed",
        command: error.command,
        exitCode: error.exitCode,
        logPath: error.logPath,
        attempt,
      };
      yield* dispatch(gateFailedEvent, dispatchCtx);

      if (attempt > maxFixAttempts) {
        const exhaustedEvent: PhaxEvent = {
          ...eventBase(),
          type: "FixAttemptsExhausted",
        };
        yield* dispatch(exhaustedEvent, dispatchCtx);
        return yield* Effect.fail(error);
      }

      const fixStartedEvent: PhaxEvent = {
        ...eventBase(),
        type: "FixStarted",
        attempt,
      };
      yield* dispatch(fixStartedEvent, dispatchCtx);

      const fs = yield* FileSystem;
      const logContent = yield* fs.readText(logPath(attempt));
      const fixPrompt = buildFixPrompt(error, logContent, attempt);

      yield* emit("fix.started", "info", { attempt });
      yield* telemetry.recordEvent(
        makeStepStartedTelemetryEvent({ runId, operationId: phaseId, step: "fix-loop" }),
      );
      const backend = yield* Backend;
      const fixResult = yield* telemetry.withOperation(
        "phax.claude-code-cli.agent.resume",
        { "phax.phase.id": phaseId },
        backend.resumeAgentSession(currentSessionId, fixPrompt, {
          model: agentOptions.model,
          effort: agentOptions.effort,
          cwd: agentOptions.cwd,
          outputJsonlPath: join(
            phaseFolderPath,
            `fix-attempt-${String(attempt).padStart(2, "0")}.jsonl`,
          ),
          phaseFolderPath: agentOptions.phaseFolderPath,
        }),
      );

      const fixCompletedEvent: PhaxEvent = {
        ...eventBase(),
        type: "FixCompleted",
        sessionId: fixResult.sessionId,
      };
      yield* dispatch(fixCompletedEvent, dispatchCtx);
      yield* emit("fix.completed", "ok", { attempt });
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: phaseId,
          step: "fix-loop",
          result: "success",
        }),
      );

      return yield* loop(attempt + 1, fixResult.sessionId);
    });
  }

  return loop(1, sessionId);
}
