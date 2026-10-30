/**
 * Coherence check: the answer's perPhase names each of the run's phases exactly once.
 *
 * Returns the refusal text, or null when perPhase covers the run:
 *   - walking the answered ids in order, an id not in the run is
 *     `perPhase: phase "<id>" is not a phase of this run`, and a run phase met
 *     a second time is `perPhase: phase "<id>" is named more than once`
 *     (reported once per id);
 *   - then, in run order, each run phase never answered is
 *     `perPhase: phase "<id>" is missing`.
 *
 * The parts are joined by '; '. The order of the answered ids is free.
 */
export function phaseCoverageRefusal(
  answeredPhaseIds: readonly string[],
  runPhaseIds: readonly string[],
): string | null {
  const runIds = new Set(runPhaseIds);
  const seen = new Set<string>();
  const reported = new Set<string>();
  const parts: string[] = [];
  for (const id of answeredPhaseIds) {
    if (!runIds.has(id)) {
      if (!reported.has(id)) {
        reported.add(id);
        parts.push(`perPhase: phase "${id}" is not a phase of this run`);
      }
      continue;
    }
    if (seen.has(id) && !reported.has(id)) {
      reported.add(id);
      parts.push(`perPhase: phase "${id}" is named more than once`);
    }
    seen.add(id);
  }
  for (const id of runPhaseIds) {
    if (!seen.has(id)) parts.push(`perPhase: phase "${id}" is missing`);
  }
  return parts.length === 0 ? null : parts.join("; ");
}
