import type { GateStep } from "../../schemas/phaxConfig.js";

export function selectGateSteps(
  steps: readonly GateStep[],
  isTerminal: boolean,
): readonly GateStep[] {
  return steps.filter((step) => step.firing === "every-phase" || isTerminal);
}
