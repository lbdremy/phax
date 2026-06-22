import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Either } from "effect";
import type { RunId, ShortName } from "../domain/branded.js";
import { interpret } from "../domain/reducer.js";
import { TERMINAL_PHASE_STATES } from "../domain/state.js";
import type { PhaxState } from "../domain/state.js";
import type { RunStatus, PhaseStatus } from "../schemas/status.js";
import { resolveRun, findCurrentPhase } from "./resolveRunInfo.js";
import { composePhaxState } from "./phaxState.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";

export type ResumeRefusalReason =
  | RunStatus["state"]
  | "no_pending_phases"
  | "missing_worktree"
  | "run_not_found";

export interface ResumeDecision {
  readonly shortName: string;
  readonly nextPhaseId: string;
  readonly nextPhaseIndex: number;
  readonly fromState: string;
  readonly worktreePath: string | undefined;
  /** Phases that were skipped (produced no changes) and will be bypassed on resume. */
  readonly skippedPhaseIds: readonly string[];
}

export interface ResumeRefusal {
  readonly reason: ResumeRefusalReason;
  readonly message: string;
}

interface NextResumablePhase {
  readonly phaseId: string;
  readonly phaseIndex: number;
  readonly worktreePath: string | undefined;
}

/**
 * Walk `planPhases` in order and return the first phase that is either
 * (a) non-terminal on disk, or (b) has no on-disk status yet (not started).
 *
 * This correctly handles the case where a phase was skipped (terminal) and the
 * *next* phase has no folder on disk — the old phaseStatuses-only scan would
 * miss it and report "no resumable phases".
 */
function findNextResumablePhase(
  phaseStatuses: readonly PhaseStatus[],
  planPhases: readonly { id: string; title: string }[],
): NextResumablePhase | undefined {
  if (planPhases.length > 0) {
    const statusByPhaseId = new Map(phaseStatuses.map((p) => [p.phaseId, p]));
    for (let i = 0; i < planPhases.length; i++) {
      const planPhase = planPhases[i];
      if (!planPhase) continue;
      const status = statusByPhaseId.get(planPhase.id);
      if (!status) {
        // No on-disk folder yet — this phase hasn't started.
        return { phaseId: planPhase.id, phaseIndex: i, worktreePath: undefined };
      }
      if (!TERMINAL_PHASE_STATES.has(status.state)) {
        return {
          phaseId: status.phaseId,
          phaseIndex: status.phaseIndex,
          worktreePath: status.worktreePath,
        };
      }
    }
    return undefined;
  }

  // Fallback when no plan is available: scan phaseStatuses directly.
  const found = phaseStatuses.find((p) => !TERMINAL_PHASE_STATES.has(p.state));
  return found
    ? { phaseId: found.phaseId, phaseIndex: found.phaseIndex, worktreePath: found.worktreePath }
    : undefined;
}

function refusalMessageForRunState(shortName: string, runState: RunStatus["state"]): string {
  switch (runState) {
    case "review_open":
      return `Run "${shortName}" is open for review. Use \`phax enter ${shortName}\` to resume the Claude session interactively.`;
    case "archived":
      return `Run "${shortName}" has been archived and cannot be resumed.`;
    case "completed":
      return `Run "${shortName}" is already completed. All phases have been executed.`;
    case "stopped":
      return `Run "${shortName}" was stopped. Create a new run to restart.`;
    case "created":
      return `Run "${shortName}" has not been started yet and cannot be resumed.`;
    case "failed":
      return `Run "${shortName}" failed and cannot be resumed. Use \`phax reset-phase ${shortName}\` to recover a specific phase, or create a new run to try again.`;
    default:
      return `Run "${shortName}" cannot be resumed from state "${runState}".`;
  }
}

export function canResume(state: PhaxState): boolean {
  const disposition = interpret(state, {
    type: "RunResumeRequested",
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    run: "" as RunId,
  });
  return disposition.kind === "Handled" || disposition.kind === "Ignored";
}

export function inspectResumeFromInfo(
  info: RunReviewInfo,
): Either.Either<ResumeDecision, ResumeRefusal> {
  const { shortName } = info;

  const currentPhase = findCurrentPhase(info.phaseStatuses);
  const state = composePhaxState(info.runState as RunStatus["state"], info.lastError, currentPhase);

  const disposition = interpret(state, {
    type: "RunResumeRequested",
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    run: info.runId as unknown as RunId,
  });

  if (disposition.kind !== "Handled" && disposition.kind !== "Ignored") {
    return Either.left({
      reason: state.run as ResumeRefusalReason,
      message: refusalMessageForRunState(shortName, state.run as RunStatus["state"]),
    });
  }

  const nextPhase = findNextResumablePhase(info.phaseStatuses, info.planPhases);
  if (!nextPhase) {
    return Either.left({
      reason: "no_pending_phases",
      message: `No resumable phases found for run "${shortName}". All phases are committed or skipped.`,
    });
  }

  if (nextPhase.worktreePath !== undefined && !existsSync(nextPhase.worktreePath)) {
    return Either.left({
      reason: "missing_worktree",
      message: `Worktree for phase "${nextPhase.phaseId}" at "${nextPhase.worktreePath}" no longer exists. The run cannot be resumed automatically.`,
    });
  }

  const skippedPhaseIds = info.phaseStatuses
    .filter((p) => p.state === "skipped" && p.phaseIndex < nextPhase.phaseIndex)
    .map((p) => p.phaseId);

  return Either.right({
    shortName,
    nextPhaseId: nextPhase.phaseId,
    nextPhaseIndex: nextPhase.phaseIndex,
    fromState: info.runState,
    worktreePath: nextPhase.worktreePath,
    skippedPhaseIds,
  });
}

export function inspectResume(
  namespace: string,
  shortName: ShortName,
  stateRoot: string,
): Either.Either<ResumeDecision, ResumeRefusal> {
  const infoResult = resolveRun(namespace, shortName, stateRoot);
  if (Either.isLeft(infoResult)) {
    return Either.left({
      reason: "run_not_found",
      message: `Run "${shortName}" not found: ${infoResult.left}`,
    });
  }
  return inspectResumeFromInfo(infoResult.right);
}
