import { Effect, Either } from "effect";
import { join } from "node:path";
import type { WorktreePath } from "../domain/branded.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { decodePhaseStatus, encodePhaseStatus } from "../schemas/status.js";

export function recordPhaseWorktreePath(
  phaseFolderPath: string,
  worktreePath: WorktreePath,
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
        worktreePath: worktreePath as string,
        updatedAt: new Date().toISOString(),
      };
      yield* fs.writeAtomic(statusPath, JSON.stringify(encodePhaseStatus(updated), null, 2));
    }
  });
}
