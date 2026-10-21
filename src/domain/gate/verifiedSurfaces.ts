import type { GateAttribution } from "../../schemas/gateAttribution.js";
import type { RecordedSurface } from "../../schemas/surface.js";

/**
 * A surface is verified when at least one step of it ran and every step of
 * that surface present in the record passed (a half-green surface is not
 * verified). A `skipped` oracle step is not a pass, so it leaves `oracle`
 * unverified.
 */
export function verifiedSurfaces(record: GateAttribution): readonly RecordedSurface[] {
  const allPassedBySurface = new Map<RecordedSurface, boolean>();
  for (const step of record.steps) {
    const passed = step.result === "pass";
    const current = allPassedBySurface.get(step.surface);
    allPassedBySurface.set(step.surface, current === undefined ? passed : current && passed);
  }
  return [...allPassedBySurface.entries()]
    .filter(([, allPassed]) => allPassed)
    .map(([surface]) => surface)
    .toSorted();
}

/**
 * The surfaces a run verified: the sorted union of each record's verified
 * surfaces, minus every surface that any record holds as a `skipped` step. A
 * skipped oracle discharge keeps `oracle` off the run's line even when another
 * phase's authored verdict passed.
 */
export function runVerifiedSurfaces(
  records: readonly GateAttribution[],
): readonly RecordedSurface[] {
  const verified = new Set<RecordedSurface>();
  const skipped = new Set<RecordedSurface>();
  for (const record of records) {
    for (const surface of verifiedSurfaces(record)) verified.add(surface);
    for (const step of record.steps) {
      if (step.result === "skipped") skipped.add(step.surface);
    }
  }
  return [...verified].filter((surface) => !skipped.has(surface)).toSorted();
}
