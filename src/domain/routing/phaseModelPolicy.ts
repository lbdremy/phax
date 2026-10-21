import type { ProviderConfig } from "../../schemas/providerConfig.js";
import { effortsFor, entryFor } from "./catalog.js";
import type { ThinkingLevel } from "./types.js";

/**
 * The phase model policy the phax-planning skill teaches: a default
 * assignment, a stronger model for a phase that designs something new, and a
 * lighter model for a phase that reproduces a pattern a gate checks. Only the
 * default names an effort.
 */
export interface PhaseModelPolicy {
  readonly defaultAssignment: { readonly model: string; readonly effort: ThinkingLevel };
  readonly stronger: { readonly model: string };
  readonly lighter: { readonly model: string };
}

// Guidance rendered into the phax-planning skill by `pnpm gen:model-catalog`.
// The bounds check (src/domain/plan/assignmentCheck.ts) compares a phase no
// assignment bound governs with `defaultAssignment`, as lint warnings; phax
// never applies it to a phase: a plan's phases carry their own model and
// effort.
export const PHASE_MODEL_POLICY: PhaseModelPolicy = {
  defaultAssignment: { model: "claude-sonnet-5-5", effort: "medium" },
  stronger: { model: "claude-opus-5-5" },
  lighter: { model: "claude-haiku-5-5" },
};

/**
 * Return one message per policy model id the catalog does not list, naming
 * the id and its role, and one when the default effort is not among the
 * default model's efforts. An empty array means the policy is valid.
 */
export function phaseModelPolicyFindings(
  policy: PhaseModelPolicy,
  providerConfig: ProviderConfig,
): readonly string[] {
  const roles: ReadonlyArray<readonly [string, string]> = [
    ["default", policy.defaultAssignment.model],
    ["stronger", policy.stronger.model],
    ["lighter", policy.lighter.model],
  ];
  const findings: string[] = [];
  for (const [role, model] of roles) {
    if (entryFor(model, providerConfig) === undefined) {
      findings.push(`${role} model ${model} is not in the catalog`);
    }
  }
  const { model, effort } = policy.defaultAssignment;
  const efforts = effortsFor(model, providerConfig);
  if (efforts !== undefined && !efforts.includes(effort)) {
    findings.push(`default effort ${effort} is not supported by ${model}`);
  }
  return findings;
}
