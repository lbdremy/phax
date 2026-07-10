import { Effect, Either } from "effect";
import { join } from "node:path";
import { FileSystem } from "../ports/fs.js";
import { decodeGateAttribution } from "../schemas/gateAttribution.js";

export function readVerifiedSurfaces(
  runPath: string,
  phaseIds: readonly string[],
): Effect.Effect<readonly string[], never, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const surfaceSet = new Set<string>();

    for (const phaseId of phaseIds) {
      const attributionPath = join(runPath, phaseId, "gate-attribution.json");
      const textResult = yield* Effect.either(fs.readText(attributionPath));
      if (Either.isLeft(textResult)) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(textResult.right) as unknown;
      } catch {
        continue;
      }

      const decoded = decodeGateAttribution(parsed);
      if (Either.isLeft(decoded)) continue;

      for (const step of decoded.right.steps) {
        if (step.result === "pass") {
          surfaceSet.add(step.surface);
        }
      }
    }

    return [...surfaceSet].toSorted();
  });
}
