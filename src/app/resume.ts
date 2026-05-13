import { existsSync } from "node:fs";
import { Either } from "effect";
import type { ShortName } from "../domain/branded.js";
import { resolveRunByShortName } from "./resolveRunInfo.js";
import type { PhaseStatus } from "../schemas/status.js";

export type ResumeRefusalReason =
  | "review_open"
  | "archived"
  | "completed"
  | "stopped"
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

  if (info.runState === "review_open") {
    return Either.left({
      reason: "review_open",
      message: `Run "${shortName}" is open for review. Use \`phax enter ${shortName}\` to resume the Claude session interactively.`,
    });
  }

  if (info.runState === "archived") {
    return Either.left({
      reason: "archived",
      message: `Run "${shortName}" has been archived and cannot be resumed.`,
    });
  }

  if (info.runState === "completed") {
    return Either.left({
      reason: "completed",
      message: `Run "${shortName}" is already completed. All phases have been executed.`,
    });
  }

  if (info.runState === "stopped") {
    return Either.left({
      reason: "stopped",
      message: `Run "${shortName}" was stopped. Create a new run to restart.`,
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
