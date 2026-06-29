import type { PhaxPlan } from "../../schemas/phaxPlan.js";
import type { PlanInput } from "./types.js";

/**
 * Pure mapping from a decoded PhaxPlan to the overlap engine's PlanInput.
 *
 * The caller supplies `id` and `label` because they vary by use case (an
 * overlap comparison labels by run short-name + path; an adjustment labels by
 * the raw plan path). The per-phase file-set projection is the shared part and
 * lives here so both callers stay in sync.
 */
export function planInputFromPhaxPlan(plan: PhaxPlan, id: string, label: string): PlanInput {
  return {
    id,
    label,
    phases: plan.phases.map((p) => ({
      create: p.plannedFilesToCreate,
      edit: p.plannedFilesToEdit,
      optional: p.optionalFilesToEdit,
    })),
  };
}
