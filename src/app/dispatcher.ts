import { Effect, Either } from "effect";
import { join } from "node:path";
import type { Disposition } from "../domain/disposition.js";
import type { PhaxCommand, PhaxCommandType, StatePatch } from "../domain/effects.js";
import type { PhaxEvent } from "../domain/events.js";
import { interpret } from "../domain/reducer.js";
import type { PhaxState } from "../domain/state.js";
import type { RegistryCorruptionError, SetupCommandFailedError } from "../domain/errors.js";
import type { RunId } from "../domain/branded.js";
import {
  makeStateTransitionTelemetryEvent,
  makeStepCompletedTelemetryEvent,
} from "../domain/telemetry/events.js";
import { FileSystem, FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import {
  decodePhaseStatus,
  decodeRunStatus,
  encodePhaseStatus,
  encodeRunStatus,
  type PhaseStatus,
  type RunStatus,
} from "../schemas/status.js";
import { run as runEffect, type EffectRunnerContext } from "./effectRunner.js";
import { composePhaxState } from "./phaxState.js";

export interface DispatcherContext {
  readonly runPath: string;
  readonly shortName: string;
  readonly phaseFolderPath?: string | undefined;
  readonly phaseId?: string | undefined;
}

export interface DispatchResult {
  readonly disposition: Disposition<PhaxState>["kind"];
  readonly reason?: string | undefined;
  readonly stateBefore: PhaxState;
  readonly stateAfter?: PhaxState | undefined;
  readonly executedEffects: readonly PhaxCommandType[];
}

function readPhaxState(ctx: DispatcherContext): Effect.Effect<PhaxState, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const runRaw = yield* fs.readText(join(ctx.runPath, "run-status.json"));
    const runParsed = JSON.parse(runRaw) as unknown;
    const runDecoded = decodeRunStatus(runParsed);
    if (Either.isLeft(runDecoded)) {
      return yield* Effect.fail(
        new FsError({ message: `Invalid run-status.json at "${ctx.runPath}"` }),
      );
    }

    let phase: PhaseStatus | undefined;
    if (ctx.phaseFolderPath !== undefined) {
      const phasePath = join(ctx.phaseFolderPath, "status.json");
      const phaseExists = yield* fs.exists(phasePath);
      if (phaseExists) {
        const phaseRaw = yield* fs.readText(phasePath);
        const phaseParsed = JSON.parse(phaseRaw) as unknown;
        const phaseDecoded = decodePhaseStatus(phaseParsed);
        if (Either.isLeft(phaseDecoded)) {
          return yield* Effect.fail(
            new FsError({ message: `Invalid status.json at "${ctx.phaseFolderPath}"` }),
          );
        }
        phase = phaseDecoded.right;
      }
    }

    return composePhaxState(runDecoded.right.state, runDecoded.right.lastError, phase);
  });
}

function runStateName(state: PhaxState): RunStatus["state"] {
  return state.run;
}

function phaseStateName(state: PhaxState): PhaseStatus["state"] | undefined {
  if ("phase" in state) return state.phase.state;
  return undefined;
}

function compositeState(state: PhaxState): string {
  const phase = phaseStateName(state);
  return phase !== undefined ? `${state.run}:${phase}` : state.run;
}

function diffPatch(before: PhaxState, after: PhaxState): StatePatch {
  const beforeRun = runStateName(before);
  const afterRun = runStateName(after);
  const beforePhase = phaseStateName(before);
  const afterPhase = phaseStateName(after);

  let runPatch: Partial<RunStatus> | undefined;
  if (beforeRun !== afterRun) {
    runPatch =
      after.run === "failed" ? { state: afterRun, lastError: after.cause } : { state: afterRun };
  }

  let phasePatch: Partial<PhaseStatus> | undefined;
  if (afterPhase !== undefined && beforePhase !== afterPhase) {
    phasePatch =
      "phase" in after && after.phase.state === "committed"
        ? { state: afterPhase, commitHash: after.phase.hash }
        : { state: afterPhase };
  }

  return {
    ...(runPatch ? { run: runPatch } : {}),
    ...(phasePatch ? { phase: phasePatch } : {}),
  };
}

/**
 * Central entry point: read the on-disk hierarchical state, run the reducer,
 * emit the disposition trace event, persist the new state when handled, and
 * execute every command the reducer produced through the effect runner.
 */
export function dispatch(
  event: PhaxEvent,
  ctx: DispatcherContext,
): Effect.Effect<
  DispatchResult,
  FsError | GitError | ShellError | SetupCommandFailedError | RegistryCorruptionError,
  FileSystem | Git | Shell | SystemTelemetry
> {
  return Effect.gen(function* () {
    const telemetry = yield* SystemTelemetry;
    const runId = ctx.shortName as unknown as RunId;
    const stateBefore = yield* readPhaxState(ctx);
    const disposition = interpret(stateBefore, event);

    if (disposition.kind !== "Handled") {
      yield* telemetry.recordEvent(
        makeStepCompletedTelemetryEvent({
          runId,
          step: `dispatch.${event.type}`,
          result:
            disposition.kind === "Ignored" || disposition.kind === "Stale" ? "success" : "failure",
        }),
      );
      return {
        disposition: disposition.kind,
        reason: disposition.reason,
        stateBefore,
        executedEffects: [],
      };
    }

    const stateAfter = disposition.nextState;
    const patch = diffPatch(stateBefore, stateAfter);

    const runnerCtx: EffectRunnerContext = {
      runPath: ctx.runPath,
      phaseFolderPath: ctx.phaseFolderPath,
      phaseId: ctx.phaseId,
      shortName: ctx.shortName,
    };

    // Persist new state first so the trace reflects committed state.
    if (patch.run !== undefined || patch.phase !== undefined) {
      yield* runEffect({ type: "PersistState", patch }, runnerCtx);
    }

    yield* telemetry.recordTransition(
      makeStateTransitionTelemetryEvent({
        runId,
        event: event.type,
        stateBefore: compositeState(stateBefore),
        stateAfter: compositeState(stateAfter),
        dispatcher: "dispatch",
      }),
    );

    // Execute reducer-emitted commands.
    const executed: PhaxCommandType[] = [];
    for (const cmd of disposition.effects) {
      yield* runEffect(cmd, runnerCtx);
      executed.push(cmd.type);
    }

    return {
      disposition: disposition.kind,
      stateBefore,
      stateAfter,
      executedEffects: executed,
    };
  });
}
