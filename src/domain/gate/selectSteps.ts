import type { GateStep } from "../../schemas/phaxConfig.js";

/**
 * Every-phase steps always run; terminal steps only run at the terminal phase.
 * Firing is behavioral (phax schedules on it) — surface stays pure attribution.
 */
export function selectGateSteps(
  steps: readonly GateStep[],
  isTerminal: boolean,
): readonly GateStep[] {
  return steps.filter((step) => step.firing === "every-phase" || isTerminal);
}
