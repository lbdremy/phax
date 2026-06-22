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
