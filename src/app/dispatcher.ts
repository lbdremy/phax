import { Effect, Either } from "effect";
import { join } from "node:path";
import type { Disposition } from "../domain/disposition.js";
import type { PhaxCommand, PhaxCommandType, StatePatch } from "../domain/effects.js";
import type { PhaxEvent } from "../domain/events.js";
import { interpret } from "../domain/reducer.js";
import type { PhaseSubState, PhaxState } from "../domain/state.js";
import { FileSystem, FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { Tracer } from "../ports/tracer.js";
import {
  decodePhaseStatus,
  decodeRunStatus,
  encodePhaseStatus,
  encodeRunStatus,
  type PhaseStatus,
  type RunStatus,
} from "../schemas/status.js";
import { run as runEffect, type EffectRunnerContext } from "./effectRunner.js";

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

function phaseSubStateFromStatus(status: PhaseStatus): PhaseSubState {
  switch (status.state) {
    case "pending":
      return { state: "pending" };
    case "setting_up_worktree":
      return { state: "setting_up_worktree" };
    case "running":
      return { state: "running" };
    case "gates_failed":
      return { state: "gates_failed", attempt: 0 };
    case "fixing":
      return { state: "fixing", attempt: 0 };
    case "passed":
      return { state: "passed" };
    case "committed":
      return { state: "committed", hash: status.commitHash ?? "" };
    case "cleaning_up":
      return { state: "cleaning_up" };
    case "cleaned_up":
      return { state: "cleaned_up" };
    case "skipped":
      return { state: "skipped" };
    case "rate_limited":
      return { state: "rate_limited" };
    case "handoff_failed":
      return { state: "handoff_failed", missing: [] };
    case "failed":
      return { state: "failed", cause: "unknown" };
    case "review_open":
      return { state: "review_open" };
  }
}

function composePhaxState(
  run: RunStatus,
  phase: PhaseStatus | undefined,
): PhaxState {
  switch (run.state) {
    case "created":
      return { run: "created" };
    case "completed":
      return { run: "completed" };
    case "stopped":
      return { run: "stopped" };
    case "archived":
      return { run: "archived" };
    case "failed":
      return { run: "failed", cause: run.lastError ?? "unknown" };
    case "review_open":
      return { run: "review_open", phase: { state: "review_open" } };
    case "running":
      return {
        run: "running",
        phase: phase ? phaseSubStateFromStatus(phase) : { state: "pending" },
      };
    case "rate_limited":
      return {
        run: "rate_limited",
        phase: phase ? phaseSubStateFromStatus(phase) : { state: "rate_limited" },
      };
    case "interrupted":
      return {
        run: "interrupted",
        phase: phase ? phaseSubStateFromStatus(phase) : { state: "pending" },
      };
  }
}

function readPhaxState(
  ctx: DispatcherContext,
): Effect.Effect<PhaxState, FsError, FileSystem> {
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

    return composePhaxState(runDecoded.right, phase);
  });
}

function runStateName(state: PhaxState): RunStatus["state"] {
  return state.run;
}

function phaseStateName(state: PhaxState): PhaseStatus["state"] | undefined {
  if ("phase" in state) return state.phase.state;
  return undefined;
}

function diffPatch(before: PhaxState, after: PhaxState): StatePatch {
  const beforeRun = runStateName(before);
  const afterRun = runStateName(after);
  const beforePhase = phaseStateName(before);
  const afterPhase = phaseStateName(after);

  let runPatch: Partial<RunStatus> | undefined;
  if (beforeRun !== afterRun) {
    runPatch =
      after.run === "failed"
        ? { state: afterRun, lastError: after.cause }
        : { state: afterRun };
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
 * emit the disposition trace event, and — when handled — persist the new
 * state, emit the legacy state.transition event, and execute every command
 * the reducer produced through the effect runner.
 */
export function dispatch(
  event: PhaxEvent,
  ctx: DispatcherContext,
): Effect.Effect<
  DispatchResult,
  FsError | GitError | ShellError,
  FileSystem | Git | Shell | Tracer
> {
  return Effect.gen(function* () {
    const tracer = yield* Tracer;
    const stateBefore = yield* readPhaxState(ctx);
    const disposition = interpret(stateBefore, event);

    const dispositionEventName =
      disposition.kind === "Handled"
        ? "event.handled"
        : disposition.kind === "Ignored"
          ? "event.ignored"
          : disposition.kind === "Stale"
            ? "event.stale"
            : disposition.kind === "Rejected"
              ? "event.rejected"
              : "event.unexpected";

    const dispositionDetails: Record<string, unknown> = {
      eventType: event.type,
      eventId: event.eventId,
      runStateBefore: stateBefore.run,
      phaseStateBefore: phaseStateName(stateBefore),
    };
    if (event.correlationId !== undefined) {
      dispositionDetails.correlationId = event.correlationId;
    }
    if (disposition.kind !== "Handled") {
      dispositionDetails.reason = disposition.reason;
    }

    if (disposition.kind !== "Handled") {
      yield* tracer.event({
        timestamp: new Date().toISOString(),
        run: ctx.shortName,
        phase: ctx.phaseId,
        event: dispositionEventName,
        status: disposition.kind === "Unexpected" ? "failed" : "info",
        details: dispositionDetails,
      });
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

    // Emit disposition trace.
    yield* tracer.event({
      timestamp: new Date().toISOString(),
      run: ctx.shortName,
      phase: ctx.phaseId,
      event: dispositionEventName,
      status: "ok",
      details: dispositionDetails,
    });

    // Emit legacy state.transition events to preserve the existing contract.
    if (patch.run !== undefined && patch.run.state !== undefined) {
      yield* tracer.event({
        timestamp: new Date().toISOString(),
        run: ctx.shortName,
        event: "state.transition",
        status: "ok",
        details: { entity: "run", to: patch.run.state },
      });
    }
    if (patch.phase !== undefined && patch.phase.state !== undefined) {
      yield* tracer.event({
        timestamp: new Date().toISOString(),
        run: ctx.shortName,
        phase: ctx.phaseId,
        event: "state.transition",
        status: "ok",
        details: { entity: "phase", to: patch.phase.state },
      });
    }

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
