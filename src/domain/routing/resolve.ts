import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import type {
  ModelFamily,
  ProviderId,
  Relationship,
  RoutingRequest,
  RoutingResolution,
  RoutingTier,
  ThinkingLevel,
} from "./types.js";

interface TierEntry {
  readonly family: ModelFamily;
  readonly effort?: ThinkingLevel | undefined;
  readonly thinking?: ThinkingLevel | undefined;
  readonly relationship?: Relationship | undefined;
}

interface FamilyResolution {
  readonly family: ModelFamily;
  readonly source: "configured" | "heuristic" | "fallback";
}

function resolveFamily(model: string, routing: ModelRouting): FamilyResolution {
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

function resolveTier(
  family: ModelFamily,
  effort: ThinkingLevel,
  routing: ModelRouting,
  unknownFallback: boolean,
): RoutingTier {
  if (unknownFallback) return routing.defaultTier;

  const entry = routing.normalization[family];
  if (!entry) return routing.defaultTier;

  if ("defaultTier" in entry && entry.defaultTier !== undefined) {
    return entry.defaultTier;
  }

  const perEffort = entry as Partial<Record<ThinkingLevel, RoutingTier>>;
  return perEffort[effort] ?? routing.defaultTier;
}

function classifyRelationship(
  entry: TierEntry,
  requestedFamily: ModelFamily,
  requestedEffort: ThinkingLevel,
): Relationship {
  if (entry.relationship) return entry.relationship;
  if (entry.family !== requestedFamily) return "equivalent";
  // Same family. When the entry pins no effort, the requested effort flows
  // through to the provider unchanged — no substitution, so this is exact.
  // When the entry pins an effort that matches the request, also exact.
  // When the entry pins a different effort (e.g. opus/max for opus/high), the
  // routing table is asking for a same-family but stronger/weaker effort, so
  // mark it equivalent.
  const entryEffort = entry.thinking ?? entry.effort;
  if (entryEffort === undefined || entryEffort === requestedEffort) {
    return "exact";
  }
  return "equivalent";
}

interface Concrete {
  readonly concreteModel: string;
  readonly thinking: ThinkingLevel | undefined;
}

function resolveConcrete(
  provider: ProviderId,
  entry: TierEntry,
  providerCfg: ProviderConfig,
): Concrete | undefined {
  const providerEntry = providerCfg.providers[provider];
  if (!providerEntry) return undefined;

  const candidateThinking = entry.thinking ?? entry.effort;

  if (provider === "mistral-vibe") {
    if (!candidateThinking) return undefined;
    const aliasKey = `${entry.family}/${candidateThinking}`;
    const alias = providerEntry.aliases?.[aliasKey];
    if (!alias) return undefined;
    return { concreteModel: alias, thinking: candidateThinking };
  }

  const concreteModel = providerEntry.families?.[entry.family]?.model;
  if (!concreteModel) return undefined;
  return { concreteModel, thinking: candidateThinking };
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

function reasonFor(
  request: RoutingRequest,
  requestedFamily: ModelFamily,
  familySource: FamilyResolution["source"],
  tier: RoutingTier,
  provider: ProviderId,
  selectedFamily: ModelFamily,
  selectedThinking: ThinkingLevel | undefined,
  relationship: Relationship,
  terminal: boolean,
): string {
  const familyOrigin =
    familySource === "configured"
      ? ""
      : familySource === "heuristic"
        ? ` (heuristic from "${request.model}")`
        : ` (unknown model "${request.model}", defaulted to claude-sonnet)`;

  const selectedDescriptor =
    selectedThinking !== undefined ? `${selectedFamily}/${selectedThinking}` : selectedFamily;

  const selection = terminal
    ? `terminal provider claude-code selected after exhausting providerPriority`
    : `Provider priority selected ${provider}`;

  return `${selection}; ${requestedFamily}/${request.effort}${familyOrigin} maps to tier ${tier}; ${provider} provides ${selectedDescriptor} (${relationship}).`;
}

export function resolveModel(
  request: RoutingRequest,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
): RoutingResolution {
  const familyResolution = resolveFamily(request.model, routing);
  const requestedFamily = familyResolution.family;
  const tier = resolveTier(
    requestedFamily,
    request.effort,
    routing,
    familyResolution.source === "fallback",
  );

  const tierEntries = routing.tiers[tier];

  for (const provider of routing.providerPriority) {
    const entry = tierEntries?.[provider];
    if (!entry) continue;

    const providerEntry = providerCfg.providers[provider];
    if (!providerEntry?.enabled) continue;

    const relationship = classifyRelationship(entry, requestedFamily, request.effort);

    if (
      requestedFamily === "claude-opus" &&
      !routing.allowDowngrade &&
      (relationship === "downgrade" || relationship === "no_equivalent")
    ) {
      continue;
    }

    const concrete = resolveConcrete(provider, entry, providerCfg);
    if (!concrete) continue;

    return {
      requested: {
        model: request.model,
        family: requestedFamily,
        effort: request.effort,
      },
      normalizedTier: tier,
      selected: buildSelected(provider, entry.family, concrete.thinking, concrete.concreteModel),
      relationship,
      reason: reasonFor(
        request,
        requestedFamily,
        familyResolution.source,
        tier,
        provider,
        entry.family,
        concrete.thinking,
        relationship,
        false,
      ),
    };
  }

  // Terminal: enabled gate intentionally does not apply here. claude-code is the
  // guaranteed baseline so resolveModel stays total regardless of its enabled flag.
  // Try the tier's claude-code entry first, then a direct claude-code/<requestedFamily> resolution.
  const terminalTierEntry = tierEntries?.["claude-code"];
  if (terminalTierEntry) {
    const concrete = resolveConcrete("claude-code", terminalTierEntry, providerCfg);
    if (concrete) {
      const relationship = classifyRelationship(terminalTierEntry, requestedFamily, request.effort);
      return {
        requested: {
          model: request.model,
          family: requestedFamily,
          effort: request.effort,
        },
        normalizedTier: tier,
        selected: buildSelected(
          "claude-code",
          terminalTierEntry.family,
          concrete.thinking,
          concrete.concreteModel,
        ),
        relationship,
        reason: reasonFor(
          request,
          requestedFamily,
          familyResolution.source,
          tier,
          "claude-code",
          terminalTierEntry.family,
          concrete.thinking,
          relationship,
          true,
        ),
      };
    }
  }

  const directModel = providerCfg.providers["claude-code"]?.families?.[requestedFamily]?.model;
  if (directModel) {
    return {
      requested: {
        model: request.model,
        family: requestedFamily,
        effort: request.effort,
      },
      normalizedTier: tier,
      selected: buildSelected("claude-code", requestedFamily, request.effort, directModel),
      relationship: "exact",
      reason: `No tier entry available for ${tier}; routed directly to claude-code/${requestedFamily}/${request.effort}.`,
    };
  }

  const sonnetFallback =
    providerCfg.providers["claude-code"]?.families?.["claude-sonnet"]?.model ?? "claude-sonnet";
  return {
    requested: {
      model: request.model,
      family: requestedFamily,
      effort: request.effort,
    },
    normalizedTier: tier,
    selected: buildSelected("claude-code", "claude-sonnet", request.effort, sonnetFallback),
    relationship: "no_equivalent",
    reason: `No matching provider for tier ${tier}; defaulted to claude-code/claude-sonnet.`,
  };
}
