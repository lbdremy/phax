import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect, Either } from "effect";
import type { RunId, ShortName } from "../domain/branded.js";
import { holdsPhase } from "../domain/hold.js";
import { interpret } from "../domain/reducer.js";
import { TERMINAL_PHASE_STATES } from "../domain/state.js";
import type { PhaxState } from "../domain/state.js";
import { FileSystem, FsError } from "../ports/fs.js";
import { readRunStatusFile } from "../schemas/persisted.js";
import type { RunHold, RunStatus, PhaseStatus } from "../schemas/status.js";
import { resolveRun, findCurrentPhase } from "./resolveRunInfo.js";
import { composePhaxState } from "./phaxState.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import { REQUIRED_HANDOFF_SECTIONS } from "./handoffGuidance.js";
import { committedHandoffIsValid, handoffPath } from "./handoffInjection.js";

export type ResumeRefusalReason =
  | RunStatus["state"]
  | "no_pending_phases"
  | "missing_worktree"
  | "handoff_unrecoverable"
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
 *
 * One state is terminal for a non-final phase but resumable for the final one:
 * `committed`. A non-final phase proceeds committed → cleanup, so a persisted
 * `committed` there is terminal. The *final* phase, however, is left `committed`
 * when the run paused at artifact completion (ArtifactCompletionFailed) — that
 * pause is resumable (executePlan re-enters the completion step), so it must be
 * surfaced here rather than reported as "no resumable phases".
 *
 * A non-final `committed` phase of the run's hold whose stop is still null is
 * resumable too: its hold point failed or was interrupted before the stop, and
 * executePlan re-enters it there. So is a non-final `committed` phase whose
 * stop is closed, of either cause: its close was interrupted before the
 * cleanup, and executePlan finishes what it still owes.
 *
 * A non-final `committed` phase in `owedHandoffs` is resumable as well: its
 * handoff turn was cut short (a limit inside it leaves the run running), and
 * executePlan re-runs only that turn before going on.
 */
export function findNextResumablePhase(
  phaseStatuses: readonly PhaseStatus[],
  planPhases: readonly { id: string; title: string }[],
  hold: RunHold,
  owedHandoffs: ReadonlySet<string>,
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
      const isFinalPlanPhase = i === planPhases.length - 1;
      const owesHeldStop =
        !isFinalPlanPhase &&
        status.state === "committed" &&
        status.stop === null &&
        holdsPhase(hold, status.phaseId);
      // A non-final `committed` phase whose stop is closed, of either cause: a
      // close was interrupted between its state event and its cleanup.
      const owesClosedStopCleanup =
        !isFinalPlanPhase && status.state === "committed" && status.stop?.status === "closed";
      const owesHandoff = status.state === "committed" && owedHandoffs.has(status.phaseId);
      const resumable =
        !TERMINAL_PHASE_STATES.has(status.state) ||
        (isFinalPlanPhase && status.state === "committed") ||
        owesHeldStop ||
        owesClosedStopCleanup ||
        owesHandoff;
      if (resumable) {
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
    // interrupted, rate_limited and awaiting_review (whose resume closes the
    // stop) are resumable, so they have no refusal message of their own.
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

/**
 * Refuses the resume of a phase that owes its handoff when the handoff turn
 * cannot run again: its worktree or its session id is gone. Names what is
 * gone and the remedy for that case. Null when the turn can run.
 */
function handoffUnrecoverable(
  info: RunReviewInfo,
  status: PhaseStatus,
  isFinal: boolean,
): ResumeRefusal | null {
  const worktreeGone = status.worktreePath === undefined || !existsSync(status.worktreePath);
  const sessionGone = status.claudeSessionId === undefined;
  if (!worktreeGone && !sessionGone) return null;
  const { shortName } = info;
  const worktree = status.worktreePath ?? "(none recorded)";
  const restore = `git worktree add ${worktree} ${status.branchName}`;
  const resumeAgain = `phax resume ${shortName} --yes`;
  const gone = [
    ...(worktreeGone ? [`its worktree "${worktree}" no longer exists`] : []),
    ...(sessionGone ? ["no session id is recorded for it"] : []),
  ].join(" and ");
  const head = `Phase "${status.phaseId}" of run "${shortName}" committed, but its handoff turn did not finish, and ${gone}.`;
  const remedy = sessionGone
    ? [
        `Write ${handoffPath(info.runPath, status.phaseId)} by hand with these four sections: ${REQUIRED_HANDOFF_SECTIONS.join(", ")}.`,
        // Completion runs in the final phase's worktree.
        ...(worktreeGone && isFinal
          ? [`Restore its worktree, which completing the run needs: \`${restore}\`.`]
          : []),
        `Then run \`${resumeAgain}\`.`,
      ]
    : [
        `Restore it with \`${restore}\`, then run \`${resumeAgain}\`: phax then writes the handoff itself.`,
      ];
  return { reason: "handoff_unrecoverable", message: [head, ...remedy].join(" ") };
}

/**
 * The resume decision for a resolved run. `hold` is the run's recorded hold,
 * read from its run-status.json: it makes a held phase whose stop is still
 * owed the start phase. `owedHandoffs` is `readOwedHandoffs` of the run: a
 * committed phase in it is the start phase, or refused when its handoff turn
 * cannot run again.
 */
export function inspectResumeFromInfo(
  info: RunReviewInfo,
  hold: RunHold,
  owedHandoffs: ReadonlySet<string>,
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

  const nextPhase = findNextResumablePhase(info.phaseStatuses, info.planPhases, hold, owedHandoffs);
  if (!nextPhase) {
    return Either.left({
      reason: "no_pending_phases",
      message: `No resumable phases found for run "${shortName}". All phases are committed or skipped.`,
    });
  }

  // Before the generic worktree check, so the refusal names its remedy.
  const owingStatus = owedHandoffs.has(nextPhase.phaseId)
    ? info.phaseStatuses.find((p) => p.phaseId === nextPhase.phaseId)
    : undefined;
  if (owingStatus !== undefined) {
    // The plan's last phase; `finalPhaseId` is only the last phase on disk.
    const finalPhaseId = info.planPhases.at(-1)?.id ?? info.finalPhaseId;
    const refusal = handoffUnrecoverable(info, owingStatus, owingStatus.phaseId === finalPhaseId);
    if (refusal !== null) return Either.left(refusal);
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
): Effect.Effect<Either.Either<ResumeDecision, ResumeRefusal>, never, FileSystem> {
  const infoResult = resolveRun(namespace, shortName, stateRoot);
  if (Either.isLeft(infoResult)) {
    return Effect.succeed(
      Either.left({
        reason: "run_not_found",
        message: `Run "${shortName}" not found: ${infoResult.left}`,
      }),
    );
  }
  const info = infoResult.right;
  return Effect.all([
    readRunHold(info.runPath),
    readOwedHandoffs(info.runPath, info.phaseStatuses),
  ]).pipe(
    Effect.match({
      onFailure: (error): Either.Either<ResumeDecision, ResumeRefusal> =>
        Either.left({ reason: "run_not_found", message: error.message }),
      onSuccess: ([hold, owedHandoffs]) => inspectResumeFromInfo(info, hold, owedHandoffs),
    }),
  );
}

/**
 * The ids of the run's phases that owe their handoff: `committed`, with no
 * stop, and no valid `phase-handoff.md` in their run folder. executePlan's
 * re-entry applies the same predicate, `committedHandoffIsValid`.
 */
export function readOwedHandoffs(
  runPath: string,
  phaseStatuses: readonly Pick<PhaseStatus, "phaseId" | "state" | "stop">[],
): Effect.Effect<ReadonlySet<string>, FsError, FileSystem> {
  return Effect.gen(function* () {
    const owed = new Set<string>();
    for (const status of phaseStatuses) {
      if (status.state !== "committed" || status.stop !== null) continue;
      if (!(yield* committedHandoffIsValid(join(runPath, status.phaseId)))) {
        owed.add(status.phaseId);
      }
    }
    return owed;
  });
}

/**
 * The hold recorded in the run's run-status.json, read through the
 * FileSystem port and the persisted reader. Fails with the reader's message
 * when the file cannot be read or decoded.
 */
export function readRunHold(runPath: string): Effect.Effect<RunHold, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(runPath, "run-status.json");
    const raw = yield* fs.readText(path);
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: () => new FsError({ message: `${path}: not valid JSON` }),
    });
    const decoded = readRunStatusFile(path, parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(new FsError({ message: decoded.left.message }));
    }
    return decoded.right.hold;
  });
}
