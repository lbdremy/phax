import type { GateStep } from "../../schemas/phaxConfig.js";

/**
 * The phase prompt's `## Gate` section: the steps the gate will run for this
 * phase, in run order, one `- <surface>: <command>` line each, then the gate
 * contract. With no step, it says so and promises no fix loop: nothing will
 * judge the phase before its commit. The fixed wording names no tool or
 * package manager.
 */
export function renderGateSection(steps: readonly GateStep[]): string[] {
  if (steps.length === 0) {
    return [
      "## Gate",
      "",
      "No gate step runs after this session: phax commits the phase as you leave it.",
      "Check each change with the narrowest command that covers it.",
      "",
    ];
  }
  const stepLines = steps.map((s) => `- ${s.surface}: ${s.command}`);
  return [
    "## Gate",
    "",
    "After this session ends, phax runs these gate steps, in order:",
    "",
    ...stepLines,
    "",
    "If a step fails, phax resumes this same session with its output and you fix it here.",
    "While you work, check each change with the narrowest command that covers it.",
    "You need not run a whole gate step before finishing: the gate runs it.",
    "",
  ];
}
