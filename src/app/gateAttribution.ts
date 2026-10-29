import { Array as Arr, Effect, Either } from "effect";
import { join } from "node:path";
import type { ProtectedChange } from "../domain/security/protectedPaths.js";
import { FileSystem, FsError } from "../ports/fs.js";
import {
  encodeGateAttributionFile,
  type GateAttribution,
  type ProtectedPathsResult,
} from "../schemas/gateAttribution.js";
import { readGateAttributionFile, withSchemaUrl } from "../schemas/persisted.js";
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

/** The record's form of a check's result: a pass with no change, else a fail naming each. */
function protectedPathsResult(changes: readonly ProtectedChange[]): ProtectedPathsResult {
  const recorded = changes.map(({ path, kind, entry }) => ({ path, kind, entry }));
  return Arr.isNonEmptyReadonlyArray(recorded)
    ? { result: "fail", changes: recorded }
    : { result: "pass", changes: [] };
}

/**
 * Rewrites an attempt's step record and the phase's gate-attribution.json with
 * the protected-paths check's result, the steps `runGates` recorded unchanged.
 * Both files are the same document, so the step record is read and written to
 * both. A step record that cannot be read as a gate attribution is a fault.
 */
export function recordProtectedPaths(input: {
  readonly stepRecordPath: string;
  readonly attributionPath: string;
  readonly changes: readonly ProtectedChange[];
}): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const raw = yield* fs.readText(input.stepRecordPath);
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) =>
        new FsError({ message: `${input.stepRecordPath} is not JSON: ${String(cause)}`, cause }),
    });
    const record = readGateAttributionFile(input.stepRecordPath, parsed);
    if (Either.isLeft(record)) {
      return yield* Effect.fail(
        new FsError({ message: `${input.stepRecordPath} is not a gate attribution` }),
      );
    }
    const attribution: GateAttribution = {
      phase: record.right.phase,
      steps: record.right.steps,
      protectedPaths: protectedPathsResult(input.changes),
    };
    const document = JSON.stringify(
      encodeGateAttributionFile(withSchemaUrl("gate-attribution", attribution)),
      null,
      2,
    );
    yield* fs.writeAtomic(input.stepRecordPath, document);
    yield* fs.writeAtomic(input.attributionPath, document);
  });
}
