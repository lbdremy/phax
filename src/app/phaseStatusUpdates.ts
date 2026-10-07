import { Effect, Either } from "effect";
import { join } from "node:path";
import type { BranchName, WorktreePath } from "../domain/branded.js";
import { FileSystem, FsError } from "../ports/fs.js";
import { readPhaseStatusFile, withSchemaUrl } from "../schemas/persisted.js";
import { encodePhaseStatus } from "../schemas/status.js";

/**
 * The phase's noted base: the commit its branch was created from, read back
 * from `status.json`. Never re-derived from git. A status the reader refuses
 * fails with the reader's message.
 */
export function readPhaseBase(phaseFolderPath: string): Effect.Effect<string, FsError, FileSystem> {
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
    return decoded.right.base;
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
