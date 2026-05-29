import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ClaudeSessionId, PhaseId, RunId, WorktreePath } from "../domain/branded.js";
import {
  PhaseHadNoChangesError,
  type RegistryCorruptionError,
  type SetupCommandFailedError,
} from "../domain/errors.js";
import type { PhaxEvent } from "../domain/events.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";
import { dispatch } from "./dispatcher.js";

export interface CommitPhaseOptions {
  readonly phase: PhaxPlanPhase;
  readonly worktreePath: WorktreePath;
  readonly phaseFolderPath: string;
  readonly runId: string;
  readonly shortName: string;
  readonly sessionId: ClaudeSessionId;
  readonly gateLogPath: string;
  readonly repoRoot: string;
  /** Run folder; the dispatcher reads run-status.json from here. */
  readonly runPath: string;
}

export interface CommitResult {
  readonly committed: true;
  readonly commitHash: string;
}

function buildCommitBody(opts: CommitPhaseOptions): string {
  const lines: string[] = [
    opts.phase.commit.body,
    "",
    "---",
    "",
    `Run-Id: ${opts.runId}`,
    `Short-Name: ${opts.shortName}`,
    `Phase-Id: ${opts.phase.id}`,
    `Phase-Title: ${opts.phase.title}`,
    `Model: ${opts.phase.model}`,
    `Effort: ${opts.phase.effort}`,
    `Worktree: ${opts.worktreePath}`,
    `Session-Id: ${opts.sessionId}`,
    `Gate-Log: ${opts.gateLogPath}`,
  ];
  return lines.join("\n");
}

function getCommitHash(worktreePath: WorktreePath): Effect.Effect<string, ShellError, Shell> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const result = yield* shell.run({
      command: ["git", "rev-parse", "HEAD"],
      cwd: worktreePath as string,
    });
    return result.stdout.trim();
  });
}

function saveDiffPatch(
  worktreePath: WorktreePath,
  phaseFolderPath: string,
): Effect.Effect<void, ShellError | FsError, Shell | FileSystem> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const fs = yield* FileSystem;

    const result = yield* shell.run({
      command: ["git", "diff", "HEAD^", "HEAD"],
      cwd: worktreePath as string,
    });

    yield* fs.writeAtomic(join(phaseFolderPath, "diff.patch"), result.stdout);
  });
}

export function commitPhase(
  opts: CommitPhaseOptions,
): Effect.Effect<
  CommitResult,
  | GitError
  | ShellError
  | FsError
  | SetupCommandFailedError
  | RegistryCorruptionError
  | PhaseHadNoChangesError,
  Git | Shell | FileSystem | SystemTelemetry
> {
  return Effect.gen(function* () {
    const git = yield* Git;

    const isClean = yield* git.worktreeIsClean(opts.worktreePath);
    if (isClean) {
      const reason = `Phase ${opts.phase.id} produced no changes — the worktree is clean after the agent finished.`;
      const noChangesEvent: PhaxEvent = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        run: opts.shortName as RunId,
        phase: opts.phase.id as PhaseId,
        type: "PhaseHadNoChanges",
        phaseId: opts.phase.id as PhaseId,
        worktreePath: opts.worktreePath,
        sessionId: opts.sessionId,
        reason,
      };
      yield* dispatch(noChangesEvent, {
        runPath: opts.runPath,
        shortName: opts.shortName,
        phaseFolderPath: opts.phaseFolderPath,
        phaseId: opts.phase.id,
      });
      return yield* Effect.fail(
        new PhaseHadNoChangesError({
          message: reason,
          phaseId: opts.phase.id,
          worktreePath: opts.worktreePath as string,
          runPath: opts.runPath,
        }),
      );
    }

    const body = buildCommitBody(opts);
    yield* git.commit(opts.worktreePath as string, opts.phase.commit.subject, body);

    const commitHash = yield* getCommitHash(opts.worktreePath);

    const event: PhaxEvent = {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      run: opts.shortName as RunId,
      phase: opts.phase.id as PhaseId,
      type: "CommitCreated",
      hash: commitHash,
    };
    yield* dispatch(event, {
      runPath: opts.runPath,
      shortName: opts.shortName,
      phaseFolderPath: opts.phaseFolderPath,
      phaseId: opts.phase.id,
    });

    yield* saveDiffPatch(opts.worktreePath, opts.phaseFolderPath);

    return { committed: true as const, commitHash };
  });
}
