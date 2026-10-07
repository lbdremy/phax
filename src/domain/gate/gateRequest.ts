import type { GateRequest } from "../../schemas/gateRequest.js";
import { projectPhases } from "../plan/projection.js";
import type { PhaxPlanPhase } from "../../schemas/phaxPlan.js";

export interface MakeGateRequestInput {
  readonly phaseId: string;
  /** The commit the gated phase's branch was created from, as noted in its status. */
  readonly base: string;
  /** True exactly when the gated phase is the run's terminal phase. */
  readonly terminal: boolean;
  readonly phases: ReadonlyArray<
    Pick<PhaxPlanPhase, "id" | "plannedFilesToCreate" | "plannedFilesToEdit">
  >;
}

/**
 * The gate request for one phase: the facts a declaring gate step reads on
 * stdin. `phases` is the plan auditor's projection (create ∪ edit, deduplicated
 * in plan order, optional files excluded). Keys come in the format's order.
 */
export function makeGateRequest(input: MakeGateRequestInput): GateRequest {
  return {
    phase: input.phaseId,
    base: input.base,
    terminal: input.terminal,
    phases: projectPhases(input.phases),
  };
}

/**
 * Names the gate request saved next to a gate attempt log, mirroring
 * `diagnosticsPathFor`: `checks-attempt-01.log` → `checks-attempt-01.request.json`.
 * A path that does not end in `.log` simply gets `.request.json` appended.
 */
export function requestPathFor(attemptLogPath: string): string {
  const base = attemptLogPath.endsWith(".log")
    ? attemptLogPath.slice(0, -".log".length)
    : attemptLogPath;
  return `${base}.request.json`;
}
