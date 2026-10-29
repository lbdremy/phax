import { Array as Arr, Effect, Either } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ClaudeSessionId, PhaseId, RunId, WorktreePath } from "../domain/branded.js";
import {
  type AgentInvocationError,
  type AgentSessionFailedError,
  type AgentSessionIdMissingError,
  GateAttemptsExhaustedError,
  GateFailedError,
  GateStepRefusedError,
  type RateLimitError,
  type RegistryCorruptionError,
  type SecurityEnforcementError,
  type SetupCommandFailedError,
  type UsageLimitError,
} from "../domain/errors.js";
import type { PhaxEvent, PhaxEventBase } from "../domain/events.js";
import type {
  NonEmptyProtectedChanges,
  ProtectedChange,
  ProtectedList,
} from "../domain/security/protectedPaths.js";
import { Backend, type AgentRunOptions } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import {
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeGateEvaluatedTelemetryEvent,
} from "../domain/telemetry/events.js";
import { makeSystemErrorReport } from "../domain/telemetry/errors.js";
import { isAgentFailure, reportAgentFailure } from "./telemetry/reportBuilders.js";
import { withInvocationCost } from "./costLedger.js";
import { dispatch } from "./dispatcher.js";
import { runGates, type GateOutcome, type OracleStep } from "./gates.js";
import type { GateStep } from "../schemas/phaxConfig.js";
import { buildFixPrompt } from "../domain/gate/fixPrompt.js";
import { reportPathFor } from "../domain/gate/reportPath.js";
import {
  attemptLogName,
  fixTranscriptName,
  lastFixTranscriptName,
  nextAttemptNumber,
  previousRecordedAttempt,
  stepRecordPathFor,
} from "../domain/gate/attemptFiles.js";
import { sameCommand } from "../domain/gate/commandWords.js";
import { readGateAttributionFile, readGateReport } from "../schemas/persisted.js";
import { recordProtectedPaths } from "./gateAttribution.js";
import { checkProtectedPaths } from "./protectedPathsCheck.js";

/**
 * What failed an attempt: a configured or oracle step (with the protected
 * changes the same attempt found, possibly none), or the protected-paths check
 * alone, when every step passed.
 */
type AttemptFailure = { readonly logPath: string } & (
  | {
      readonly failedStep: "configured" | "oracle";
      readonly command: string;
      readonly exitCode: number;
      readonly reportFindings: GateFailedError["reportFindings"];
      readonly stderrExcerpt: string | undefined;
      readonly protectedChanges: readonly ProtectedChange[];
    }
  | {
      readonly failedStep: "protected-paths";
      readonly protectedChanges: NonEmptyProtectedChanges;
    }
);

function pathsOf(changes: readonly ProtectedChange[]): string {
  return changes.map((change) => change.path).join(", ");
}

export interface RunGatesWithFixLoopOptions {
  readonly steps: readonly GateStep[];
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
  /** Canonical worktree path emitted in FixAttemptsExhausted (defaults to cwd). */
  readonly worktreePath?: string;
  /** The phase's serialized gate request, passed unchanged to every attempt. */
  readonly gateRequest: string;
  /** The phase's oracle step, passed unchanged to every attempt. */
  readonly oracleStep?: OracleStep;
  /** The protected list and the phase base to check every attempt's files
   *  against, or null when the project declares none: then nothing is
   *  observed and no record is rewritten. */
  readonly protectedPaths: {
    readonly list: ProtectedList;
    readonly base: string;
  } | null;
}

export function runGatesWithFixLoop(
  opts: RunGatesWithFixLoopOptions,
): Effect.Effect<
  GateOutcome,
  | GateAttemptsExhaustedError
  | GateStepRefusedError
  | FsError
  | ShellError
  | GitError
  | SetupCommandFailedError
  | AgentInvocationError
  | AgentSessionFailedError
  | AgentSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | RegistryCorruptionError,
  Shell | FileSystem | Backend | Git | SystemTelemetry
> {
  const {
    steps,
    cwd,
    phaseFolderPath,
    sessionId,
    agentOptions,
    maxFixAttempts,
    run,
    phaseId,
    runPath,
    gateRequest,
    oracleStep,
    protectedPaths,
  } = opts;
  const resolvedWorktreePath = opts.worktreePath ?? cwd;

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
    return join(phaseFolderPath, attemptLogName(attempt));
  }

  /** The names in the phase folder, or none when it does not exist yet. */
  function phaseFolderNames(): Effect.Effect<readonly string[], FsError, FileSystem> {
    return Effect.gen(function* () {
      const fs = yield* FileSystem;
      if (!(yield* fs.exists(phaseFolderPath))) return [];
      return yield* fs.list(phaseFolderPath);
    });
  }

  /**
   * The finding ids of the checked report that the step with the same command
   * printed in the previous recorded attempt (the highest-numbered log below
   * this one, across entries), found through that attempt's step record. No
   * previous attempt, no step record (a folder written before step records),
   * no step with that command, or a report that is missing, unreadable or
   * refused gives the empty set.
   */
  function previousFindingIds(
    attempt: number,
    failingCommand: string,
  ): Effect.Effect<ReadonlySet<string>, never, FileSystem> {
    const none: ReadonlySet<string> = new Set<string>();
    return Effect.gen(function* () {
      const fs = yield* FileSystem;
      const previous = previousRecordedAttempt(yield* phaseFolderNames(), attempt);
      if (previous === undefined) return none;
      const recordPath = stepRecordPathFor(logPath(previous));
      if (!(yield* fs.exists(recordPath))) return none;
      const recordRaw = yield* fs.readText(recordPath);
      const recordParsed = yield* Effect.try(() => JSON.parse(recordRaw) as unknown);
      const record = readGateAttributionFile(recordPath, recordParsed);
      if (Either.isLeft(record)) return none;
      const index = record.right.steps.findIndex((step) =>
        sameCommand(step.command, failingCommand),
      );
      if (index === -1) return none;
      const path = reportPathFor(logPath(previous), index + 1);
      if (!(yield* fs.exists(path))) return none;
      const raw = yield* fs.readText(path);
      const parsed = yield* Effect.try(() => JSON.parse(raw) as unknown);
      const read = readGateReport(parsed);
      if (Either.isLeft(read) || read.right.outcome !== "checked") return none;
      return new Set(read.right.findings.map((finding) => finding.id));
    }).pipe(Effect.orElseSucceed(() => none));
  }

  /**
   * The attempt's protected changes against the phase base, recorded in its
   * step record and the phase's gate-attribution.json. Nothing at all (no
   * observation, no rewrite) when the project declares no list.
   */
  function checkAttempt(
    attempt: number,
  ): Effect.Effect<readonly ProtectedChange[], GitError | FsError, Git | FileSystem> {
    if (protectedPaths === null) return Effect.succeed([]);
    return Effect.gen(function* () {
      const changes = yield* checkProtectedPaths({
        worktree: cwd,
        base: protectedPaths.base,
        list: protectedPaths.list,
      });
      yield* recordProtectedPaths({
        stepRecordPath: stepRecordPathFor(logPath(attempt)),
        attributionPath: join(phaseFolderPath, "gate-attribution.json"),
        changes,
      });
      return changes;
    });
  }

  function loop(
    currentSessionId: ClaudeSessionId,
    fixesUsed: number,
  ): Effect.Effect<
    GateOutcome,
    | GateAttemptsExhaustedError
    | GateStepRefusedError
    | FsError
    | ShellError
    | GitError
    | SetupCommandFailedError
    | AgentInvocationError
    | AgentSessionFailedError
    | AgentSessionIdMissingError
    | RateLimitError
    | UsageLimitError
    | SecurityEnforcementError
    | RegistryCorruptionError,
    Shell | FileSystem | Backend | Git | SystemTelemetry
  > {
    return Effect.gen(function* () {
      const telemetry = yield* SystemTelemetry;
      const runId = run as unknown as RunId;
      // Numbered from the folder at every attempt, so numbering continues
      // across every entry into the gate and no existing file is overwritten.
      const attempt = nextAttemptNumber(yield* phaseFolderNames());

      yield* telemetry.recordEvent(
        makeStepStartedTelemetryEvent({ runId, operationId: phaseId, step: `gate.run` }),
      );
      const gateResult = yield* Effect.either(
        runGates({
          steps,
          cwd,
          attemptLogPath: logPath(attempt),
          attributionPath: join(phaseFolderPath, "gate-attribution.json"),
          phaseId,
          gateRequest,
          ...(oracleStep === undefined ? {} : { oracleStep }),
        }),
      );

      // The protected-paths check runs after the steps, whatever they did: a
      // pass, a failure or a refusal alike. A fault of the run itself (a shell
      // or file error) is judged by nothing and goes up unchecked.
      const judged =
        Either.isRight(gateResult) ||
        gateResult.left instanceof GateFailedError ||
        gateResult.left instanceof GateStepRefusedError;
      const changes = judged ? yield* checkAttempt(attempt) : [];

      let failure: AttemptFailure;
      if (Either.isRight(gateResult)) {
        if (!Arr.isNonEmptyReadonlyArray(changes)) {
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
        // Every step passed, yet the attempt changed protected paths: it fails
        // for the check alone. No command failed, so no error report.
        failure = {
          failedStep: "protected-paths",
          protectedChanges: changes,
          logPath: gateResult.right.attemptLogPath,
        };
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
            reason: `protected paths: ${changes.length} changed`,
          }),
        );
      } else {
        const error = gateResult.left;
        if (error instanceof GateStepRefusedError) {
          // A refusal goes to the operator: the gate is recorded as rejected and
          // the phase pauses, with no fix prompt and no fix attempt counted.
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
              reason: `refused: ${error.command}`,
            }),
          );
          const gateFailedEvent: PhaxEvent = {
            ...eventBase(),
            type: "GateFailed",
            failedStep: error.failedStep,
            command: error.command,
            exitCode: error.exitCode,
            protectedChanges: changes,
            logPath: error.logPath,
            attempt,
          };
          yield* dispatch(gateFailedEvent, dispatchCtx);
          const refusedEvent: PhaxEvent = {
            ...eventBase(),
            type: "GateStepRefused",
            attempt,
            phaseId: phaseId as PhaseId,
            worktreePath: resolvedWorktreePath as WorktreePath,
            sessionId: currentSessionId,
            command: error.command,
            reason: error.reason,
            remedy: error.remedy,
            failedStep: error.failedStep,
            protectedChanges: changes,
          };
          yield* dispatch(refusedEvent, dispatchCtx);
          return yield* Effect.fail(
            new GateStepRefusedError({
              message: error.message,
              command: error.command,
              reason: error.reason,
              remedy: error.remedy,
              exitCode: error.exitCode,
              logPath: error.logPath,
              phaseId: error.phaseId,
              failedStep: error.failedStep,
              protectedChanges: changes,
            }),
          );
        }

        if (!(error instanceof GateFailedError)) {
          return yield* Effect.fail(error);
        }

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
        yield* telemetry.recordError(
          makeSystemErrorReport({
            type: "gate.failed",
            runId,
            operationId: phaseId,
            adapter: "shell",
            operation: `gate.${error.command}`,
            exitCode: error.exitCode,
            ...(error.stderrExcerpt !== undefined ? { stderrExcerpt: error.stderrExcerpt } : {}),
            cause: error,
          }),
        );
        failure = {
          failedStep: error.failedStep,
          command: error.command,
          exitCode: error.exitCode,
          reportFindings: error.reportFindings,
          stderrExcerpt: error.stderrExcerpt,
          protectedChanges: changes,
          logPath: error.logPath,
        };
      }

      const gateFailedEvent: PhaxEvent =
        failure.failedStep === "protected-paths"
          ? {
              ...eventBase(),
              type: "GateFailed",
              failedStep: failure.failedStep,
              protectedChanges: failure.protectedChanges,
              logPath: failure.logPath,
              attempt,
            }
          : {
              ...eventBase(),
              type: "GateFailed",
              failedStep: failure.failedStep,
              command: failure.command,
              exitCode: failure.exitCode,
              protectedChanges: failure.protectedChanges,
              logPath: failure.logPath,
              attempt,
            };
      yield* dispatch(gateFailedEvent, dispatchCtx);

      if (fixesUsed >= maxFixAttempts) {
        // The highest-numbered fix transcript of the phase folder, which an
        // earlier entry into the gate may have left, or none.
        const lastTranscript = lastFixTranscriptName(yield* phaseFolderNames());
        const lastFixTranscript =
          lastTranscript === undefined ? null : join(phaseFolderPath, lastTranscript);
        const exhaustedBase = {
          ...eventBase(),
          type: "FixAttemptsExhausted",
          attempt,
          phaseId: phaseId as PhaseId,
          worktreePath: resolvedWorktreePath as WorktreePath,
          sessionId: currentSessionId,
          lastFixTranscript,
        } as const;
        const exhaustedEvent: PhaxEvent =
          failure.failedStep === "protected-paths"
            ? {
                ...exhaustedBase,
                failedStep: failure.failedStep,
                protectedChanges: failure.protectedChanges,
              }
            : {
                ...exhaustedBase,
                failedStep: failure.failedStep,
                command: failure.command,
                protectedChanges: failure.protectedChanges,
              };
        yield* dispatch(exhaustedEvent, dispatchCtx);
        const budget = `after ${maxFixAttempts} fix attempt(s)`;
        return yield* Effect.fail(
          failure.failedStep === "protected-paths"
            ? new GateAttemptsExhaustedError({
                message: `Gate attempts exhausted: protected paths changed (${pathsOf(failure.protectedChanges)}) ${budget}`,
                logPath: failure.logPath,
                attempt,
                phaseId: phaseId as string,
                failure: {
                  failedStep: failure.failedStep,
                  protectedChanges: failure.protectedChanges,
                },
                lastFixTranscript,
              })
            : new GateAttemptsExhaustedError({
                message: `Gate attempts exhausted: ${failure.command} (exit ${failure.exitCode})${
                  failure.protectedChanges.length === 0
                    ? ""
                    : ` and protected paths changed (${pathsOf(failure.protectedChanges)})`
                } ${budget}`,
                logPath: failure.logPath,
                attempt,
                phaseId: phaseId as string,
                failure: {
                  failedStep: failure.failedStep,
                  command: failure.command,
                  exitCode: failure.exitCode,
                  protectedChanges: failure.protectedChanges,
                },
                lastFixTranscript,
              }),
        );
      }

      const fixStartedEvent: PhaxEvent = {
        ...eventBase(),
        type: "FixStarted",
        attempt,
      };
      yield* dispatch(fixStartedEvent, dispatchCtx);

      const fs = yield* FileSystem;
      const fixPrompt =
        failure.failedStep === "protected-paths"
          ? buildFixPrompt({
              attempt,
              failedStep: failure.failedStep,
              protectedChanges: failure.protectedChanges,
              // Only a declared list fails an attempt on the check alone.
              protectedBase:
                protectedPaths === null
                  ? yield* Effect.dieMessage("A protected-paths failure with no protected list")
                  : protectedPaths.base,
            })
          : buildFixPrompt({
              command: failure.command,
              exitCode: failure.exitCode,
              attempt,
              logContent: yield* fs.readText(logPath(attempt)),
              logPath: failure.logPath,
              reportFindings: failure.reportFindings,
              stillFailing:
                failure.reportFindings === null
                  ? new Set<string>()
                  : yield* previousFindingIds(attempt, failure.command),
              failedStep: failure.failedStep,
              protectedChanges: failure.protectedChanges,
              protectedBase: protectedPaths?.base ?? null,
            });

      yield* telemetry.recordEvent(
        makeStepStartedTelemetryEvent({ runId, operationId: phaseId, step: "fix-loop" }),
      );
      const backend = yield* Backend;
      const fixResult = yield* telemetry.withOperation(
        `phax.${agentOptions.provider}.agent.resume`,
        { "phax.phase.id": phaseId },
        withInvocationCost(
          backend.resumeAgentSession(currentSessionId, fixPrompt, {
            ...agentOptions,
            outputJsonlPath: join(phaseFolderPath, fixTranscriptName(attempt)),
          }),
          {
            role: "fix",
            phase: phaseId,
            runId,
            runPath,
            provider: agentOptions.provider,
            streamPath: join(phaseFolderPath, fixTranscriptName(attempt)),
          },
        ).pipe(
          Effect.tapError((e) =>
            isAgentFailure(e)
              ? telemetry.recordError(
                  reportAgentFailure(e, {
                    runId,
                    operationId: phaseId,
                    adapter: agentOptions.provider,
                    operation: "agent.resume",
                  }),
                )
              : Effect.void,
          ),
        ),
      );

      const fixCompletedEvent: PhaxEvent = {
        ...eventBase(),
        type: "FixCompleted",
        sessionId: fixResult.sessionId,
      };
      yield* dispatch(fixCompletedEvent, dispatchCtx);
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          operationId: phaseId,
          step: "fix-loop",
          result: "success",
        }),
      );

      return yield* loop(fixResult.sessionId, fixesUsed + 1);
    });
  }

  // Each entry into the gate keeps the full fix budget.
  return loop(sessionId, 0);
}
