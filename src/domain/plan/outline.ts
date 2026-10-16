/**
 * The plan outline a phase prompt carries in place of the other phases'
 * sections (spec phase-prompt-scope §4): every phase's id, title, and planned
 * files to create and edit. Optional files are not part of it. Pure.
 */

export interface OutlinePhase {
  readonly id: string;
  readonly title: string;
  readonly plannedFilesToCreate: readonly string[];
  readonly plannedFilesToEdit: readonly string[];
}

function pathList(paths: readonly string[]): string {
  return paths.length === 0 ? "(none)" : paths.map((p) => `\`${p}\``).join(", ");
}

export function renderPlanOutline(phases: readonly OutlinePhase[], currentPhaseId: string): string {
  return phases
    .flatMap((phase) => [
      `- ${phase.id} — ${phase.title}${phase.id === currentPhaseId ? " ← current phase" : ""}`,
      `  create: ${pathList(phase.plannedFilesToCreate)}`,
      `  edit: ${pathList(phase.plannedFilesToEdit)}`,
    ])
    .join("\n");
}
