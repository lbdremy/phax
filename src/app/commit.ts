import { Effect, Either } from "effect";
import { join } from "node:path";
import type { ClaudeSessionId, WorktreePath } from "../domain/branded.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { decodePhaseStatus, encodePhaseStatus } from "../schemas/status.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";

export interface CommitPhaseOptions {
  readonly phase: PhaxPlanPhase;
  readonly worktreePath: WorktreePath;
  readonly phaseFolderPath: string;
  readonly runId: string;
  readonly shortName: string;
  readonly sessionId: ClaudeSessionId;
  readonly gateLogPath: string;
  readonly repoRoot: string;
}

export interface CommitResult {
  readonly committed: boolean;
  readonly commitHash?: string | undefined;
  readonly skippedReason?: string | undefined;
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

function updatePhaseWithCommit(
  phaseFolderPath: string,
  commitHash: string,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const statusPath = join(phaseFolderPath, "status.json");
    const raw = yield* fs.readText(statusPath);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    const decoded = decodePhaseStatus(parsed);
    if (Either.isRight(decoded)) {
      const updated = {
        ...decoded.right,
        state: "committed" as const,
        commitHash,
        updatedAt: new Date().toISOString(),
      };
      yield* fs.writeAtomic(statusPath, JSON.stringify(encodePhaseStatus(updated), null, 2));
    }
  });
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
): Effect.Effect<CommitResult, GitError | ShellError | FsError, Git | Shell | FileSystem> {
  return Effect.gen(function* () {
    const git = yield* Git;

    const isClean = yield* git.worktreeIsClean(opts.worktreePath);
    if (isClean) {
      return { committed: false, skippedReason: "no changes to commit" };
    }

    const body = buildCommitBody(opts);
    yield* git.commit(opts.worktreePath as string, opts.phase.commit.subject, body);

    const commitHash = yield* getCommitHash(opts.worktreePath);

    yield* updatePhaseWithCommit(opts.phaseFolderPath, commitHash);

    yield* saveDiffPatch(opts.worktreePath, opts.phaseFolderPath);

    return { committed: true, commitHash };
  });
}
