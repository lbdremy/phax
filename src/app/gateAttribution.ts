import { Effect, Either } from "effect";
import { join } from "node:path";
import { FileSystem } from "../ports/fs.js";
import { decodeGateAttribution } from "../schemas/gateAttribution.js";
import type { Surface } from "../schemas/phaxConfig.js";
import { verifiedSurfaces } from "../domain/gate/verifiedSurfaces.js";

function readPhaseVerifiedSurfaces(
  runPath: string,
  phaseId: string,
): Effect.Effect<readonly Surface[], never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = join(runPath, phaseId, "gate-attribution.json");
    const raw = yield* fs.readText(path).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (raw === undefined) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }

    const decoded = decodeGateAttribution(parsed);
    return Either.isRight(decoded) ? verifiedSurfaces(decoded.right) : [];
  });
}

/**
 * Unions the verified surfaces across every phase's gate-attribution.json.
 * A phase whose gate never ran, or whose record is missing/undecodable, is
 * skipped rather than treated as an error (a phase may have been reset).
 */
export function aggregateVerifiedSurfaces(
  runPath: string,
  phaseIds: readonly string[],
): Effect.Effect<readonly Surface[], never, FileSystem> {
  return Effect.gen(function* () {
    const perPhase = yield* Effect.forEach(phaseIds, (phaseId) =>
      readPhaseVerifiedSurfaces(runPath, phaseId),
    );
    const union = new Set<Surface>();
    for (const surfaces of perPhase) {
      for (const surface of surfaces) union.add(surface);
    }
    return [...union].toSorted();
  });
}
