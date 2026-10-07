import type { PhaxPlanPhase } from "../../schemas/phaxPlan.js";

export interface ProjectedPhase {
  readonly id: string;
  readonly files: readonly string[];
}

type ProjectablePhase = Pick<PhaxPlanPhase, "id" | "plannedFilesToCreate" | "plannedFilesToEdit">;

export function projectPhases(phases: ReadonlyArray<ProjectablePhase>): readonly ProjectedPhase[] {
  return phases.map((phase) => ({
    id: phase.id,
    files: [...new Set([...phase.plannedFilesToCreate, ...phase.plannedFilesToEdit])],
  }));
}

export interface PlanAuditRequest {
  readonly phases: readonly ProjectedPhase[];
}

export function makePlanAuditRequest(phases: ReadonlyArray<ProjectablePhase>): PlanAuditRequest {
  return { phases: projectPhases(phases) };
}
