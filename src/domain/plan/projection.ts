import type { PhaxPlanPhase } from "../../schemas/phaxPlan.js";

export interface ProjectedPhase {
  readonly id: string;
  readonly files: readonly string[];
}

export interface ScopesRequest {
  readonly phase: string;
  readonly phases: readonly ProjectedPhase[];
}

type ProjectablePhase = Pick<PhaxPlanPhase, "id" | "plannedFilesToCreate" | "plannedFilesToEdit">;

export function projectPhases(phases: ReadonlyArray<ProjectablePhase>): readonly ProjectedPhase[] {
  return phases.map((phase) => ({
    id: phase.id,
    files: [...new Set([...phase.plannedFilesToCreate, ...phase.plannedFilesToEdit])],
  }));
}

export function makeScopesRequest(
  phases: ReadonlyArray<ProjectablePhase>,
  gatedPhaseId: string,
): ScopesRequest {
  return {
    phase: gatedPhaseId,
    phases: projectPhases(phases),
  };
}
