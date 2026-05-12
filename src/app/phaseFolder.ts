import { Effect } from "effect";
import { join } from "node:path";
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
): Effect.Effect<string, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    const phasePath = join(runPath, phaseDir(phase.id));
    yield* fs.mkdirp(phasePath);

    const now = nowIso();
    const phaseStatus: PhaseStatus = {
      version: 1,
      phaseId: phase.id,
      phaseIndex,
      state: "pending",
      model: phase.model,
      effort: phase.effort,
      createdAt: now,
      updatedAt: now,
    };

    yield* fs.writeAtomic(join(phasePath, "status.json"), JSON.stringify(phaseStatus, null, 2));

    return phasePath;
  });
}
