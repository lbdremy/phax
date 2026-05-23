import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Either } from "effect";
import type { RunId, ShortName } from "../domain/branded.js";
import { interpret } from "../domain/reducer.js";
import type { RunStatus, PhaseStatus } from "../schemas/status.js";
import { resolveRunByShortName, findCurrentPhase } from "./resolveRunInfo.js";
import { composePhaxState } from "./phaxState.js";

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
}

export interface ResumeRefusal {
  readonly reason: ResumeRefusalReason;
  readonly message: string;
}

const TERMINAL_PHASE_STATES = new Set(["committed", "cleaned_up", "review_open", "skipped"]);

function findNextResumablePhase(phaseStatuses: readonly PhaseStatus[]): PhaseStatus | undefined {
  return phaseStatuses.find((p) => !TERMINAL_PHASE_STATES.has(p.state));
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
      return `Run "${shortName}" failed and cannot be resumed. Create a new run to try again.`;
    default:
      return `Run "${shortName}" cannot be resumed from state "${runState}".`;
  }
}

export function inspectResume(
  shortName: ShortName,
  stateRoot: string,
): Either.Either<ResumeDecision, ResumeRefusal> {
  const infoResult = resolveRunByShortName(shortName, stateRoot);
  if (Either.isLeft(infoResult)) {
    return Either.left({
      reason: "run_not_found",
      message: `Run "${shortName}" not found: ${infoResult.left}`,
    });
  }
  const info = infoResult.right;

  const currentPhase = findCurrentPhase(info.phaseStatuses);
  const state = composePhaxState(
    info.runState as RunStatus["state"],
    info.lastError,
    currentPhase,
  );

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

  const nextPhase = findNextResumablePhase(info.phaseStatuses);
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

  return Either.right({
    shortName,
    nextPhaseId: nextPhase.phaseId,
    nextPhaseIndex: nextPhase.phaseIndex,
    fromState: info.runState,
    worktreePath: nextPhase.worktreePath,
  });
}
