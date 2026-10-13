import type { GlobalFileReconciliation } from "./global.js";
import type { ReconciliationResult } from "./types.js";

export function deviationPaths(result: ReconciliationResult): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const p of [
    ...result.unplannedCreated,
    ...result.unplannedEdited,
    ...result.missingPlannedCreate,
    ...result.missingPlannedEdit,
  ]) {
    if (!seen.has(p)) {
      seen.add(p);
      paths.push(p);
    }
  }
  return paths;
}

export function findUnexplainedDeviations(
  paths: readonly string[],
  handoffMarkdown: string,
): string[] {
  return paths.filter((p) => !handoffMarkdown.includes(p));
}

/** A run-wide deviation that no handoff of its phases names. */
export interface UnexplainedDeviation {
  readonly path: string;
  readonly kind: "unplanned" | "missing";
  // The phases it is attributed to: touched-in when unplanned, planned-in when missing.
  readonly phaseIds: readonly string[];
}

/**
 * The run's unplanned and missing files whose path appears in none of the
 * handoffs of the phases they are attributed to (a phase without a handoff
 * counts as an empty one). Unplanned entries come first, then missing ones,
 * each in the reconciliation's order.
 */
export function findUnexplainedGlobalDeviations(
  global: GlobalFileReconciliation,
  phaseHandoffs: ReadonlyArray<{ readonly phaseId: string; readonly handoffMd: string }>,
): ReadonlyArray<UnexplainedDeviation> {
  const handoffs = new Map(phaseHandoffs.map((p) => [p.phaseId, p.handoffMd]));
  const isUnexplained = (path: string, phaseIds: readonly string[]): boolean => {
    const combined = phaseIds.map((pid) => handoffs.get(pid) ?? "").join("\n");
    return findUnexplainedDeviations([path], combined).length > 0;
  };
  const unexplained: UnexplainedDeviation[] = [];
  for (const entry of global.unplanned) {
    if (isUnexplained(entry.path, entry.touchedInPhases)) {
      unexplained.push({ path: entry.path, kind: "unplanned", phaseIds: entry.touchedInPhases });
    }
  }
  for (const entry of global.missing) {
    if (isUnexplained(entry.path, entry.plannedInPhases)) {
      unexplained.push({ path: entry.path, kind: "missing", phaseIds: entry.plannedInPhases });
    }
  }
  return unexplained;
}
