import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { CatalogEntry, ProviderConfig } from "../../schemas/providerConfig.js";
import { equivalentFor, familyOfId, isClaudeFamily } from "./catalog.js";
import type {
  ModelFamily,
  ProviderId,
  Relationship,
  RoutingRequest,
  RoutingResolution,
  SecurityFilter,
  ThinkingLevel,
} from "./types.js";

interface FamilyResolution {
  readonly family: ModelFamily;
  readonly source: "catalog" | "configured" | "heuristic" | "fallback";
}

function resolveFamily(
  model: string,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
): FamilyResolution {
  const catalogFamily = familyOfId(model, providerCfg);
  if (catalogFamily) return { family: catalogFamily, source: "catalog" };

  const configured = routing.requestedModelNormalization[model];
  if (configured) return { family: configured, source: "configured" };

  const lower = model.toLowerCase();
  if (lower.includes("sonnet")) return { family: "claude-sonnet", source: "heuristic" };
  if (lower.includes("opus")) return { family: "claude-opus", source: "heuristic" };
  if (lower.includes("haiku")) return { family: "claude-haiku", source: "heuristic" };
  if (lower.includes("mistral")) return { family: "mistral-medium", source: "heuristic" };
  if (lower.includes("gpt") || lower.includes("openai") || lower.includes("chatgpt")) {
    return { family: "openai-gpt", source: "heuristic" };
  }

  return { family: "claude-sonnet", source: "fallback" };
}

function pickActiveEntry(
  provider: ProviderId,
  family: ModelFamily,
  requestedId: string,
  providerCfg: ProviderConfig,
): CatalogEntry | undefined {
  const familyEntry = providerCfg.providers[provider]?.families?.[family];
  if (!familyEntry) return undefined;
  const exact = familyEntry.models.find((m) => m.id === requestedId && m.status === "active");
  if (exact) return exact;
  const anyActive = familyEntry.models.find((m) => m.status === "active");
  if (anyActive) return anyActive;
  // Fall back to the first entry even if deprecated — resolveModel stays total.
  return familyEntry.models[0];
}

function nearestSupportedEffort(entry: CatalogEntry, effort: ThinkingLevel): ThinkingLevel {
  if (entry.efforts.includes(effort)) return effort;
  // Reuse the ordinal-based nearest-effort helper via a per-entry providerCfg
  // wrapping isn't ergonomic; recompute inline against the entry's own efforts.
  const ORDINAL: Record<ThinkingLevel, number> = {
    none: 0,
    off: 0,
    low: 1,
    medium: 2,
    high: 3,
    xhigh: 4,
    max: 5,
    ultracode: 6,
  };
  const target = ORDINAL[effort];
  let best = entry.efforts[0];
  let bestDistance = Math.abs(ORDINAL[best] - target);
  for (const candidate of entry.efforts) {
    const d = Math.abs(ORDINAL[candidate] - target);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function buildSelected(
  provider: ProviderId,
  family: ModelFamily,
  thinking: ThinkingLevel | undefined,
  concreteModel: string,
): RoutingResolution["selected"] {
  if (thinking === undefined) {
    return { provider, family, concreteModel };
  }
  return { provider, family, thinking, concreteModel };
}

// Append a sentence to the resolution reason listing every provider skipped
// because the caller-supplied security filter rejected it, and attach the
// structured `skippedForSecurity` field. Returns the resolution unchanged when
// no skips occurred so existing no-filter call sites stay byte-for-byte equal.
function finalize(
  base: RoutingResolution,
  skipped: ReadonlyArray<{ provider: ProviderId; reason: string }>,
): RoutingResolution {
  if (skipped.length === 0) return base;
  const list = skipped.map((s) => `${s.provider} (${s.reason})`).join(", ");
  return {
    ...base,
    reason: `${base.reason} Skipped for security: ${list}.`,
    skippedForSecurity: skipped.map((s) => ({ provider: s.provider, reason: s.reason })),
  };
}

function familyOriginNote(request: RoutingRequest, source: FamilyResolution["source"]): string {
  switch (source) {
    case "catalog":
      return "";
    case "configured":
      return "";
    case "heuristic":
      return ` (heuristic from "${request.model}")`;
    case "fallback":
      return ` (unknown model "${request.model}", defaulted to claude-sonnet)`;
  }
}

function reasonForSameFamily(
  request: RoutingRequest,
  requestedFamily: ModelFamily,
  familySource: FamilyResolution["source"],
  provider: ProviderId,
  concreteModel: string,
  selectedEffort: ThinkingLevel | undefined,
  relationship: Relationship,
  terminal: boolean,
): string {
  const origin = familyOriginNote(request, familySource);
  const selection = terminal
    ? "terminal provider claude-code selected after exhausting providerPriority"
    : `Provider priority selected ${provider}`;
  const effortSuffix = selectedEffort !== undefined ? `/${selectedEffort}` : "";
  return `${selection}; ${requestedFamily}/${request.effort}${origin} runs natively on ${provider} as ${concreteModel}${effortSuffix} (${relationship}).`;
}

function reasonForCrossFamily(
  request: RoutingRequest,
  requestedFamily: ModelFamily,
  familySource: FamilyResolution["source"],
  provider: ProviderId,
  selectedFamily: ModelFamily,
  concreteModel: string,
  selectedEffort: ThinkingLevel | undefined,
  relationship: Relationship,
): string {
  const origin = familyOriginNote(request, familySource);
  const effortSuffix = selectedEffort !== undefined ? `/${selectedEffort}` : "";
  return `Provider priority selected ${provider}; ${requestedFamily}/${request.effort}${origin} translated via Claude hub to ${selectedFamily} → ${concreteModel}${effortSuffix} (${relationship}).`;
}

function tryProviderSameFamily(
  provider: ProviderId,
  request: RoutingRequest,
  familyResolution: FamilyResolution,
  providerCfg: ProviderConfig,
  terminal: boolean,
): RoutingResolution | undefined {
  const requestedFamily = familyResolution.family;
  const entry = pickActiveEntry(provider, requestedFamily, request.model, providerCfg);
  if (!entry) return undefined;
  const clampedEffort = nearestSupportedEffort(entry, request.effort);
  const idMatches = entry.id === request.model;
  const effortMatches = clampedEffort === request.effort;
  const relationship: Relationship = idMatches && effortMatches ? "exact" : "equivalent";
  return {
    requested: {
      model: request.model,
      family: requestedFamily,
      effort: request.effort,
    },
    selected: buildSelected(provider, requestedFamily, clampedEffort, entry.id),
    relationship,
    reason: reasonForSameFamily(
      request,
      requestedFamily,
      familyResolution.source,
      provider,
      entry.id,
      clampedEffort,
      relationship,
      terminal,
    ),
  };
}

function tryProviderCrossFamily(
  provider: ProviderId,
  request: RoutingRequest,
  familyResolution: FamilyResolution,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
): RoutingResolution | undefined {
  const providerFamilies = providerCfg.providers[provider]?.families;
  if (!providerFamilies) return undefined;

  for (const family of Object.keys(providerFamilies) as ModelFamily[]) {
    if (family === familyResolution.family) continue;
    const substitution = equivalentFor(request.model, request.effort, family, routing, providerCfg);
    if (!substitution) continue;
    if (!routing.allowDowngrade) {
      if (substitution.relation === "downgrade" || substitution.relation === "no_equivalent") {
        continue;
      }
    }
    // The equivalent id must be in this provider's family models.
    const familyEntry = providerFamilies[family];
    const entry = familyEntry?.models.find((m) => m.id === substitution.id);
    if (!entry) continue;

    return {
      requested: {
        model: request.model,
        family: familyResolution.family,
        effort: request.effort,
      },
      selected: buildSelected(provider, family, substitution.effort, entry.id),
      relationship: substitution.relation,
      reason: reasonForCrossFamily(
        request,
        familyResolution.family,
        familyResolution.source,
        provider,
        family,
        entry.id,
        substitution.effort,
        substitution.relation,
      ),
    };
  }
  return undefined;
}

function tryProvider(
  provider: ProviderId,
  request: RoutingRequest,
  familyResolution: FamilyResolution,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
): RoutingResolution | undefined {
  const providerEntry = providerCfg.providers[provider];
  if (!providerEntry) return undefined;
  if (!providerEntry.families?.[familyResolution.family]) {
    return tryProviderCrossFamily(provider, request, familyResolution, routing, providerCfg);
  }
  return tryProviderSameFamily(provider, request, familyResolution, providerCfg, false);
}

function terminalClaudeCode(
  request: RoutingRequest,
  familyResolution: FamilyResolution,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
): RoutingResolution {
  const requestedFamily = familyResolution.family;

  // Same-family Claude request: resolve natively against claude-code's catalog.
  if (isClaudeFamily(requestedFamily)) {
    const sameFamily = tryProviderSameFamily(
      "claude-code",
      request,
      familyResolution,
      providerCfg,
      true,
    );
    if (sameFamily) return sameFamily;
  }

  // Non-Claude plan family: try spoke→hub via the equivalence table.
  if (!isClaudeFamily(requestedFamily)) {
    const claudeFamilies = providerCfg.providers["claude-code"]?.families;
    if (claudeFamilies) {
      for (const family of Object.keys(claudeFamilies) as ModelFamily[]) {
        if (!isClaudeFamily(family)) continue;
        const substitution = equivalentFor(
          request.model,
          request.effort,
          family,
          routing,
          providerCfg,
        );
        if (!substitution) continue;
        if (!routing.allowDowngrade) {
          if (substitution.relation === "downgrade" || substitution.relation === "no_equivalent") {
            continue;
          }
        }
        const familyEntry = claudeFamilies[family];
        const entry = familyEntry?.models.find((m) => m.id === substitution.id);
        if (!entry) continue;
        return {
          requested: {
            model: request.model,
            family: requestedFamily,
            effort: request.effort,
          },
          selected: buildSelected("claude-code", family, substitution.effort, entry.id),
          relationship: substitution.relation,
          reason: reasonForCrossFamily(
            request,
            requestedFamily,
            familyResolution.source,
            "claude-code",
            family,
            entry.id,
            substitution.effort,
            substitution.relation,
          ),
        };
      }
    }
  }

  // Sonnet fallback: guaranteed baseline for the terminal.
  const sonnetEntry = pickActiveEntry("claude-code", "claude-sonnet", request.model, providerCfg);
  if (sonnetEntry) {
    const clamped = nearestSupportedEffort(sonnetEntry, request.effort);
    return {
      requested: {
        model: request.model,
        family: requestedFamily,
        effort: request.effort,
      },
      selected: buildSelected("claude-code", "claude-sonnet", clamped, sonnetEntry.id),
      relationship: "no_equivalent",
      reason: `No matching provider for ${requestedFamily}/${request.effort}; defaulted to claude-code/claude-sonnet.`,
    };
  }

  // Absolute last resort: preserve the requested id verbatim so resolveModel
  // stays total even when providerConfig is empty.
  return {
    requested: {
      model: request.model,
      family: requestedFamily,
      effort: request.effort,
    },
    selected: buildSelected("claude-code", "claude-sonnet", request.effort, request.model),
    relationship: "no_equivalent",
    reason: `No matching provider for ${requestedFamily}/${request.effort}; defaulted to claude-code with requested id.`,
  };
}

/**
 * Resolve a phase's requested `(model, effort)` against the routing config and
 * the provider catalog. Same-family requests resolve natively; cross-family
 * requests translate through the Claude-hub equivalence table with
 * `allowDowngrade` acting as the capability floor. claude-code is the
 * guaranteed terminal.
 */
export function resolveModel(
  request: RoutingRequest,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
  securityFilter?: SecurityFilter,
): RoutingResolution {
  const familyResolution = resolveFamily(request.model, routing, providerCfg);
  const skippedForSecurity: Array<{ provider: ProviderId; reason: string }> = [];

  for (const provider of routing.providerPriority) {
    const providerEntry = providerCfg.providers[provider];
    if (!providerEntry?.enabled) continue;

    if (securityFilter) {
      const decision = securityFilter(provider);
      if (!decision.allowed) {
        skippedForSecurity.push({
          provider,
          reason: decision.reason ?? "blocked by security policy",
        });
        continue;
      }
    }

    const resolution = tryProvider(provider, request, familyResolution, routing, providerCfg);
    if (resolution) {
      return finalize(resolution, skippedForSecurity);
    }
  }

  return finalize(
    terminalClaudeCode(request, familyResolution, routing, providerCfg),
    skippedForSecurity,
  );
}
