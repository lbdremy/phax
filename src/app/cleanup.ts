import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import type { PhaseId, RunId, WorktreePath } from "../domain/branded.js";
import {
  ArchiveBlockedByDirtyWorktreeError,
  RegistryCorruptionError,
  SetupCommandFailedError,
} from "../domain/errors.js";
import type { PhaxEvent } from "../domain/events.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { dispatch } from "./dispatcher.js";
import { run as runEffect } from "./effectRunner.js";

export interface CleanupPhaseOptions {
  readonly worktreePath: WorktreePath;
  readonly phaseFolderPath: string;
  readonly cleanupCommands: readonly string[];
  readonly repoRoot: string;
  readonly isFinalPhase: boolean;
  /** Run folder; the dispatcher reads run-status.json from here. */
  readonly runPath: string;
  /** Run short name, for dispatch context and event base. */
  readonly shortName: string;
  /** Current phase id, for dispatch context and event base. */
  readonly phaseId: string;
}

export function cleanupPhase(
  opts: CleanupPhaseOptions,
): Effect.Effect<
  void,
  | SetupCommandFailedError
  | ArchiveBlockedByDirtyWorktreeError
  | GitError
  | ShellError
  | FsError
  | RegistryCorruptionError,
  Git | Shell | FileSystem | SystemTelemetry
> {
  const {
    worktreePath,
    phaseFolderPath,
    cleanupCommands,
    repoRoot,
    isFinalPhase,
    runPath,
    shortName,
    phaseId,
  } = opts;

  return Effect.gen(function* () {
    if (isFinalPhase) {
      return;
    }

    const git = yield* Git;

    const isClean = yield* git.worktreeIsClean(worktreePath);
    if (!isClean) {
      return yield* Effect.fail(
        new ArchiveBlockedByDirtyWorktreeError({
          message: `Worktree at "${worktreePath}" has uncommitted changes. Cannot run cleanup.`,
          worktreePath: worktreePath as string,
        }),
      );
    }

    const dispatchCtx = { runPath, shortName, phaseFolderPath, phaseId } as const;
    const runnerCtx = { runPath, phaseFolderPath, phaseId, shortName } as const;

    const baseEvent = () => ({
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      run: shortName as RunId,
      phase: phaseId as PhaseId,
    });

    const startedEvent: PhaxEvent = { ...baseEvent(), type: "CleanupStarted" };
    yield* dispatch(startedEvent, dispatchCtx);

    yield* runEffect(
      { type: "RunCleanupShell", commands: cleanupCommands, cwd: worktreePath as string },
      runnerCtx,
    );

    const completedEvent: PhaxEvent = { ...baseEvent(), type: "CleanupCompleted" };
    yield* dispatch(completedEvent, dispatchCtx);
  });
}
