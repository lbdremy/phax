import { Effect, Either } from "effect";
import { join } from "node:path";
import type { BranchName, ClaudeSessionId, WorktreePath } from "../domain/branded.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { decodePhaseStatus, encodePhaseStatus } from "../schemas/status.js";

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

    const decoded = decodePhaseStatus(parsed);
    if (Either.isRight(decoded)) {
      const updated = {
        ...decoded.right,
        worktreePath: worktreePath as string,
        branchName,
        updatedAt: new Date().toISOString(),
      };
      yield* fs.writeAtomic(statusPath, JSON.stringify(encodePhaseStatus(updated), null, 2));
    }
  });
}

export function recordPhaseSessionId(
  phaseFolderPath: string,
  sessionId: ClaudeSessionId,
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
        claudeSessionId: sessionId as string,
        updatedAt: new Date().toISOString(),
      };
      yield* fs.writeAtomic(statusPath, JSON.stringify(encodePhaseStatus(updated), null, 2));
    }
  });
}
