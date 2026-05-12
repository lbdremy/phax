import { Effect, Either } from "effect";
import { join } from "node:path";
import type { WorktreePath } from "../domain/branded.js";
import { ArchiveBlockedByDirtyWorktreeError, SetupCommandFailedError } from "../domain/errors.js";
import { Git, type GitError } from "../ports/git.js";
import { Shell, type ShellError } from "../ports/shell.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { decodePhaseStatus, encodePhaseStatus } from "../schemas/status.js";

function parseCommandTokens(raw: string): readonly [string, ...string[]] {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (parts.length === 0 || first === undefined) {
    throw new Error(`Empty cleanup command: "${raw}"`);
  }
  return [first, ...parts.slice(1)];
}

function updatePhaseState(
  phaseFolderPath: string,
  state: "cleaning_up" | "cleaned_up",
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
        state,
        updatedAt: new Date().toISOString(),
      };
      yield* fs.writeAtomic(statusPath, JSON.stringify(encodePhaseStatus(updated), null, 2));
    }
  });
}

export interface CleanupPhaseOptions {
  readonly worktreePath: WorktreePath;
  readonly phaseFolderPath: string;
  readonly cleanupCommands: readonly string[];
  readonly repoRoot: string;
  readonly isFinalPhase: boolean;
}

export function cleanupPhase(
  opts: CleanupPhaseOptions,
): Effect.Effect<
  void,
  SetupCommandFailedError | ArchiveBlockedByDirtyWorktreeError | GitError | ShellError | FsError,
  Git | Shell | FileSystem
> {
  const { worktreePath, phaseFolderPath, cleanupCommands, repoRoot, isFinalPhase } = opts;

  return Effect.gen(function* () {
    if (isFinalPhase) {
      return;
    }

    const git = yield* Git;
    const shell = yield* Shell;

    const isClean = yield* git.worktreeIsClean(worktreePath);
    if (!isClean) {
      return yield* Effect.fail(
        new ArchiveBlockedByDirtyWorktreeError({
          message: `Worktree at "${worktreePath}" has uncommitted changes. Cannot run cleanup.`,
          worktreePath: worktreePath as string,
        }),
      );
    }

    yield* updatePhaseState(phaseFolderPath, "cleaning_up");

    for (const rawCommand of cleanupCommands) {
      let tokens: readonly [string, ...string[]];
      try {
        tokens = parseCommandTokens(rawCommand);
      } catch {
        continue;
      }

      const result = yield* shell.run({
        command: tokens,
        cwd: worktreePath as string,
      });

      if (result.exitCode !== 0) {
        return yield* Effect.fail(
          new SetupCommandFailedError({
            message: `Cleanup command failed: ${rawCommand} (exit ${result.exitCode})`,
            command: rawCommand,
            exitCode: result.exitCode,
            stderr: result.stderr,
          }),
        );
      }
    }

    yield* git.removeWorktree(worktreePath, false, repoRoot);

    yield* updatePhaseState(phaseFolderPath, "cleaned_up");
  });
}
