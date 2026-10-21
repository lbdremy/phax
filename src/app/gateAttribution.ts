import { Effect, Either } from "effect";
import { join } from "node:path";
import { FileSystem } from "../ports/fs.js";
import type { GateAttribution } from "../schemas/gateAttribution.js";
import { readGateAttributionFile } from "../schemas/persisted.js";
import type { RecordedSurface } from "../schemas/surface.js";
import { runVerifiedSurfaces } from "../domain/gate/verifiedSurfaces.js";

function readPhaseAttribution(
  runPath: string,
  phaseId: string,
): Effect.Effect<GateAttribution | undefined, never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(runPath, phaseId, "gate-attribution.json");
    const raw = yield* fs.readText(path).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (raw === undefined) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }

    const decoded = readGateAttributionFile(path, parsed);
    return Either.isRight(decoded) ? decoded.right : undefined;
  });
}

/**
 * The run's verified surfaces (`runVerifiedSurfaces`) across every phase's
 * gate-attribution.json. A phase whose gate never ran, or whose record is
 * missing/undecodable, is skipped rather than treated as an error (a phase may
 * have been reset).
 */
export function aggregateVerifiedSurfaces(
  runPath: string,
  phaseIds: readonly string[],
): Effect.Effect<readonly RecordedSurface[], never, FileSystem> {
  return Effect.gen(function* () {
    const perPhase = yield* Effect.forEach(phaseIds, (phaseId) =>
      readPhaseAttribution(runPath, phaseId),
    );
    return runVerifiedSurfaces(perPhase.filter((record) => record !== undefined));
  });
}
