import { Effect } from "effect";
import { join } from "node:path";
import type { BranchName } from "../domain/branded.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { PhaxPlanPhase } from "../schemas/phaxPlan.js";
import { type PhaseStatus } from "../schemas/status.js";

function nowIso(): string {
  return new Date().toISOString();
}

function phaseDir(phaseId: string): string {
  return phaseId;
}

export function createPhaseFolder(
  runPath: string,
  phase: PhaxPlanPhase,
  phaseIndex: number,
  branchName: BranchName,
): Effect.Effect<string, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    const phasePath = join(runPath, phaseDir(phase.id));
    yield* fs.mkdirp(phasePath);

    // Idempotent: when resuming a rate-limited phase the folder already exists.
    // Preserve its status.json so the phase keeps its rate_limited/worktree/
    // session state instead of being reset to `pending`.
    const statusPath = join(phasePath, "status.json");
    if (yield* fs.exists(statusPath)) {
      return phasePath;
    }

    const now = nowIso();
    const phaseStatus: PhaseStatus = {
      version: 1,
      phaseId: phase.id,
      phaseIndex,
      state: "pending",
      model: phase.model,
      effort: phase.effort,
      branchName,
      createdAt: now,
      updatedAt: now,
    };

    yield* fs.writeAtomic(statusPath, JSON.stringify(phaseStatus, null, 2));

    return phasePath;
  });
}
