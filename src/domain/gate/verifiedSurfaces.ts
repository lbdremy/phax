import type { GateAttribution } from "../../schemas/gateAttribution.js";
import type { Surface } from "../../schemas/phaxConfig.js";

/**
 * A surface is verified when at least one step of it ran and every step of
 * that surface present in the record passed (a half-green surface is not
 * verified).
 */
export function verifiedSurfaces(record: GateAttribution): readonly Surface[] {
  const allPassedBySurface = new Map<Surface, boolean>();
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
