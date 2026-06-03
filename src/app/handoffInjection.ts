import { Effect, Option } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";

export function handoffPath(runPath: string, phaseId: string): string {
  return join(runPath, phaseId, "phase-handoff.md");
}

export function resolveHandoffPath(
  runPath: string,
  phases: readonly { readonly id: string }[],
  currentPhaseIndex: number,
): Option.Option<string> {
  if (currentPhaseIndex === 0) return Option.none();
  const previousPhase = phases[currentPhaseIndex - 1];
  if (previousPhase === undefined) return Option.none();
  return Option.some(handoffPath(runPath, previousPhase.id));
}

export function readPreviousHandoff(
  runPath: string,
  phases: readonly { readonly id: string }[],
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
  phases: readonly { readonly id: string }[],
  currentPhaseIndex: number,
): Effect.Effect<string | undefined, FsError, FileSystem> {
  return Effect.gen(function* () {
    if (currentPhaseIndex === 0) return undefined;
    const previousPhase = phases[currentPhaseIndex - 1];
    if (previousPhase === undefined) return undefined;
    const fs = yield* FileSystem;
    const path = reconciliationPath(runPath, previousPhase.id);
    const exists = yield* fs.exists(path);
    if (!exists) return undefined;
    return yield* fs.readText(path);
  });
}
