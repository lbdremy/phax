import { Effect, Either, Schema } from "effect";
import { join } from "node:path";
import type { BranchName, WorktreePath } from "../domain/branded.js";
import { FileSystem, FsError } from "../ports/fs.js";
import { readPhaseStatusFile, withSchemaUrl } from "../schemas/persisted.js";
import { encodePhaseStatus, FullCommitShaSchema, type PhaseStatus } from "../schemas/status.js";

type PhaseState = PhaseStatus["state"];

/**
 * The phase's noted base: the commit its branch was created from, read back
 * from `status.json`. Never re-derived from git. A status the reader refuses
 * fails with the reader's message.
 */
export function readPhaseBase(phaseFolderPath: string): Effect.Effect<string, FsError, FileSystem> {
  return readPhaseStatus(phaseFolderPath).pipe(Effect.map((status) => status.base));
}

/**
 * The phase's noted commit: `status.json`'s `commitHash`, never re-derived
 * from git, or null when the phase noted none (a skipped phase, or one that
 * has not committed yet), with the phase's id and state. Fails, naming the
 * phase, when the noted hash is not a full object name.
 */
export function readPhaseCommit(phaseFolderPath: string): Effect.Effect<
  {
    readonly phaseId: string;
    readonly state: PhaseState;
    readonly commit: string | null;
  },
  FsError,
  FileSystem
> {
  return Effect.gen(function* () {
    const status = yield* readPhaseStatus(phaseFolderPath);
    const hash = status.commitHash;
    if (hash !== undefined && !isFullCommit(hash)) {
      return yield* Effect.fail(
        new FsError({
          message: `${status.phaseId}'s noted commit "${hash}" is not a full object name`,
        }),
      );
    }
    return { phaseId: status.phaseId, state: status.state, commit: hash ?? null };
  });
}

const isFullCommit = Schema.is(FullCommitShaSchema);

/** The phase's `status.json`, through the persisted reader; a refusal is an FsError. */
export function readPhaseStatus(
  phaseFolderPath: string,
): Effect.Effect<PhaseStatus, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const statusPath = join(phaseFolderPath, "status.json");
    const raw = yield* fs.readText(statusPath);
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: () => new FsError({ message: `${statusPath}: not valid JSON` }),
    });
    const decoded = readPhaseStatusFile(statusPath, parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(new FsError({ message: decoded.left.message }));
    }
    return decoded.right;
  });
}

export function recordPhaseWorktreeAndBranch(
  phaseFolderPath: string,
  worktreePath: WorktreePath,
  branchName: BranchName,
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

    const decoded = readPhaseStatusFile(statusPath, parsed);
    if (Either.isRight(decoded)) {
      const updated = {
        ...decoded.right,
        worktreePath: worktreePath as string,
        branchName,
        updatedAt: new Date().toISOString(),
      };
      yield* fs.writeAtomic(
        statusPath,
        JSON.stringify(encodePhaseStatus(withSchemaUrl("phase-status", updated)), null, 2),
      );
    }
  });
}
