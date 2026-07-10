import { entryFor, equivalentFor, nearestEfforts } from "./catalog.js";
import type { ModelFamily, ThinkingLevel } from "./types.js";
import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";

interface PreflightAlternative {
  readonly id: string;
  readonly family: ModelFamily;
  readonly efforts: readonly ThinkingLevel[];
}

export interface PreflightFailure {
  readonly phaseId: string;
  readonly model: string;
  readonly effort: ThinkingLevel;
  readonly reasons: readonly string[];
  readonly alternatives: readonly PreflightAlternative[];
}

export interface PreflightPhase {
  readonly id: string;
  readonly model: string;
  readonly effort: ThinkingLevel;
}

function activeEntriesForFamily(
  family: ModelFamily,
  effort: ThinkingLevel,
  providerCfg: ProviderConfig,
): PreflightAlternative[] {
  const result: PreflightAlternative[] = [];
  for (const providerEntry of Object.values(providerCfg.providers)) {
    const familyEntry = providerEntry.families?.[family];
    if (!familyEntry) continue;
    for (const entry of familyEntry.models) {
      if (entry.status === "deprecated") continue;
      if (entry.efforts.includes(effort)) {
        result.push({ id: entry.id, family, efforts: entry.efforts });
      }
    }
  }
  return result;
}

function hasPermittedCrossFamilyRoute(
  model: string,
  effort: ThinkingLevel,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
): boolean {
  for (const providerEntry of Object.values(providerCfg.providers)) {
    if (!providerEntry.enabled) continue;
    if (!providerEntry.families) continue;
    for (const family of Object.keys(providerEntry.families) as ModelFamily[]) {
      const sub = equivalentFor(model, effort, family, routing, providerCfg);
      if (!sub) continue;
      if (
        !routing.allowDowngrade &&
        (sub.relation === "downgrade" || sub.relation === "no_equivalent")
      ) {
        continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Validate every phase's model and effort against the catalog and equivalence
 * table. Returns structured failures with catalog-derived alternatives for
 * each offending phase so the planning agent can self-correct.
 *
 * Pure — no I/O. Must be called before any agent or git work begins.
 */
export function preflightPhaseModels(
  phases: readonly PreflightPhase[],
  routing: ModelRouting,
  providerConfig: ProviderConfig,
): { readonly failures: readonly PreflightFailure[] } {
  const failures: PreflightFailure[] = [];

  for (const phase of phases) {
    const reasons: string[] = [];
    const alternatives: PreflightAlternative[] = [];
    const effort = phase.effort;

    const location = entryFor(phase.model, providerConfig);
    if (!location) {
      failures.push({
        phaseId: phase.id,
        model: phase.model,
        effort,
        reasons: [`model id "${phase.model}" not found in catalog`],
        alternatives: [],
      });
      continue;
    }

    const { provider, family, entry } = location;

    if (!entry.efforts.includes(effort)) {
      reasons.push(
        `effort "${effort}" is not supported by ${phase.model} (supports: ${entry.efforts.join(", ")})`,
      );
      const otherEfforts = nearestEfforts(phase.model, effort, providerConfig);
      alternatives.push({ id: entry.id, family, efforts: otherEfforts });
    }

    if (entry.status === "deprecated") {
      reasons.push(`model "${phase.model}" is deprecated`);
      const actives = activeEntriesForFamily(family, effort, providerConfig);
      for (const alt of actives) {
        if (!alternatives.some((a) => a.id === alt.id)) {
          alternatives.push(alt);
        }
      }
    }

    const providerEnabled = providerConfig.providers[provider]?.enabled ?? false;
    if (!providerEnabled) {
      const hasCrossFamily = hasPermittedCrossFamilyRoute(
        phase.model,
        effort,
        routing,
        providerConfig,
      );
      if (!hasCrossFamily) {
        reasons.push(
          `provider "${provider}" is disabled and no permitted cross-family equivalence route exists`,
        );
      }
    }

    if (reasons.length > 0) {
      failures.push({ phaseId: phase.id, model: phase.model, effort, reasons, alternatives });
    }
  }

  return { failures };
}
