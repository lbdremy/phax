import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";
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
  /** The log of the gate attempt that let the commit through, or null when no
   *  attempt is recorded; null is written as `Gate-Log: none`. */
  readonly gateLogPath: string | null;
  readonly repoRoot: string;
  /** Run folder; the dispatcher reads run-status.json from here. */
  readonly runPath: string;
}

export interface CommitResult {
  readonly committed: true;
  readonly commitHash: string;
}

/**
 * The `Gate-Log` trailer value: the log's POSIX path relative to the run
 * folder, or `none` for no log, a path that is not absolute (never resolved
 * against the working directory) or one outside the run folder.
 */
export function gateLogTrailerValue(runPath: string, gateLogPath: string | null): string {
  if (gateLogPath === null || !isAbsolute(gateLogPath)) return "none";
  const rel = relative(runPath, gateLogPath);
  if (
    rel === "" ||
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\")
  ) {
    return "none";
  }
  return rel.replaceAll("\\", "/");
}

/**
 * Reads a `Gate-Log` trailer back to the absolute log path: null for null or
 * `none`, an absolute value (written by an older version) as is, any other
 * value joined onto the run folder.
 */
export function resolveGateLogTrailer(runPath: string, value: string | null): string | null {
  if (value === null || value === "none") return null;
  if (isAbsolute(value)) return value;
  return join(runPath, value);
}

export function buildCommitBody(opts: CommitPhaseOptions): string {
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
    `Gate-Log: ${gateLogTrailerValue(opts.runPath, opts.gateLogPath)}`,
  ];
  return lines.join("\n");
}

export interface InteractiveCommitBodyOptions {
  readonly phase: Pick<PhaxPlanPhase, "id" | "title" | "commit">;
  readonly runId: string;
  readonly shortName: string;
  /** Run folder: the `Gate-Log` trailer is written relative to it. */
  readonly runPath: string;
  /** The log of the closing gate attempt whose tree the commit holds: its `Gate-Log` trailer. */
  readonly gateLogPath: string;
}

/**
 * The body of a declared interactive phase's commit: the plan's body, then
 * the trailers. No `Model`, `Effort` or `Session-Id`: no agent session wrote
 * the correction. `Phase-Id` stays, as `phax records explain` finds a phase's
 * commits by it. Trailers written, in order: `Run-Id`, `Short-Name`,
 * `Phase-Id`, `Phase-Title`, `Interactive-Phase`, `Gate-Log` (relative to the
 * run folder, or `none`). None names a path outside the run.
 */
export function buildInteractiveCommitBody(opts: InteractiveCommitBodyOptions): string {
  return [
    opts.phase.commit.body,
    "",
    "---",
    "",
    `Run-Id: ${opts.runId}`,
    `Short-Name: ${opts.shortName}`,
    `Phase-Id: ${opts.phase.id}`,
    `Phase-Title: ${opts.phase.title}`,
    `Interactive-Phase: ${opts.phase.id}`,
    `Gate-Log: ${gateLogTrailerValue(opts.runPath, opts.gateLogPath)}`,
  ].join("\n");
}

/**
 * The body of a held stop's review commit: one line saying a person corrected
 * the phase, then the trailers. No `Phase-Id`, `Model`, `Effort` or
 * `Session-Id`: the review commit names neither a record nor an agent, and
 * the phase commit it sits on keeps its own trailers. Trailers written, in
 * order: `Run-Id`, `Short-Name`, `Phase-Title`, `Held-Phase`, `Gate-Log`
 * (relative to the run folder, or `none`). None names a path outside the run.
 */
export function buildHeldReviewCommitBody(opts: InteractiveCommitBodyOptions): string {
  return [
    `Review corrections to ${opts.phase.id} (${opts.phase.title}), made by a person at a held stop.`,
    "",
    "---",
    "",
    `Run-Id: ${opts.runId}`,
    `Short-Name: ${opts.shortName}`,
    `Phase-Title: ${opts.phase.title}`,
    `Held-Phase: ${opts.phase.id}`,
    `Gate-Log: ${gateLogTrailerValue(opts.runPath, opts.gateLogPath)}`,
  ].join("\n");
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
