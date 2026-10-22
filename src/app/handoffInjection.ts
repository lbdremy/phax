import { Effect, Either, Option } from "effect";
import { join } from "node:path";
import type { ReviewCorrectionStop } from "../domain/interactive/reviewCorrections.js";
import { FileSystem, FsError } from "../ports/fs.js";
import { readPhaseFileReconciliationFile } from "../schemas/persisted.js";
import type { PhaseMode } from "../schemas/phaxPlan.js";
import type { PhaseStatus } from "../schemas/status.js";

/** What the lookups read of a plan phase: its id and whether an agent built it. */
export interface InjectionPhase {
  readonly id: string;
  readonly mode: PhaseMode;
}

export function handoffPath(runPath: string, phaseId: string): string {
  return join(runPath, phaseId, "phase-handoff.md");
}

// The nearest phase before `currentPhaseIndex` that an agent built: an
// interactive phase's handoff and reconciliation are the person's
// corrections, which reach later prompts under `## Review corrections`.
function previousHeadlessPhase(
  phases: readonly InjectionPhase[],
  currentPhaseIndex: number,
): InjectionPhase | undefined {
  for (let i = currentPhaseIndex - 1; i >= 0; i--) {
    const phase = phases[i];
    if (phase !== undefined && phase.mode === "headless") return phase;
  }
  return undefined;
}

export function resolveHandoffPath(
  runPath: string,
  phases: readonly InjectionPhase[],
  currentPhaseIndex: number,
): Option.Option<string> {
  const previousPhase = previousHeadlessPhase(phases, currentPhaseIndex);
  if (previousPhase === undefined) return Option.none();
  return Option.some(handoffPath(runPath, previousPhase.id));
}

export function readPreviousHandoff(
  runPath: string,
  phases: readonly InjectionPhase[],
  currentPhaseIndex: number,
): Effect.Effect<string | undefined, FsError, FileSystem> {
  return Effect.gen(function* () {
    const pathOpt = resolveHandoffPath(runPath, phases, currentPhaseIndex);
    if (Option.isNone(pathOpt)) return undefined;
    const fs = yield* FileSystem;
    const exists = yield* fs.exists(pathOpt.value);
    if (!exists) return undefined;
    return yield* fs.readText(pathOpt.value);
  });
}

export function reconciliationPath(runPath: string, phaseId: string): string {
  return join(runPath, phaseId, "file-reconciliation.md");
}

export function readPreviousReconciliation(
  runPath: string,
  phases: readonly InjectionPhase[],
  currentPhaseIndex: number,
): Effect.Effect<string | undefined, FsError, FileSystem> {
  return Effect.gen(function* () {
    const previousPhase = previousHeadlessPhase(phases, currentPhaseIndex);
    if (previousPhase === undefined) return undefined;
    const fs = yield* FileSystem;
    const path = reconciliationPath(runPath, previousPhase.id);
    const exists = yield* fs.exists(path);
    if (!exists) return undefined;
    return yield* fs.readText(path);
  });
}

/**
 * Every closed stop before `phaseIndex`, in plan order: each earlier
 * interactive phase whose status says `stop.status` is `closed`, with its
 * `phase-handoff.md` (the interactive handoff) and the `reviewCorrections` of
 * its `file-reconciliation.json`. Empty when the run has no closed stop.
 */
export function readReviewCorrections(
  runPath: string,
  phases: readonly InjectionPhase[],
  phaseIndex: number,
  phaseStatuses: readonly Pick<PhaseStatus, "phaseId" | "stop">[],
): Effect.Effect<readonly ReviewCorrectionStop[], FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const stops: ReviewCorrectionStop[] = [];
    for (const phase of phases.slice(0, Math.max(phaseIndex, 0))) {
      if (phase.mode !== "interactive") continue;
      const status = phaseStatuses.find((s) => s.phaseId === phase.id);
      if (status?.stop?.status !== "closed") continue;
      const handoff = yield* fs.readText(handoffPath(runPath, phase.id));
      const reconPath = join(runPath, phase.id, "file-reconciliation.json");
      const raw = yield* fs.readText(reconPath);
      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw) as unknown,
        catch: () => new FsError({ message: `${reconPath}: not valid JSON` }),
      });
      const decoded = readPhaseFileReconciliationFile(reconPath, parsed);
      if (Either.isLeft(decoded)) {
        return yield* Effect.fail(new FsError({ message: decoded.left.message }));
      }
      stops.push({
        phaseId: phase.id,
        handoff,
        changedFiles: decoded.right.reviewCorrections,
      });
    }
    return stops;
  });
}
