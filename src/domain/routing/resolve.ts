import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import { FAMILY_EFFORTS, isEffortSupported } from "./types.js";
import type {
  EffortLevel,
  ModelFamily,
  ProviderId,
  Relationship,
  RoutingRequest,
  RoutingResolution,
  RoutingTier,
  SecurityFilter,
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

// Ordinal positions used to clamp a requested effort to the nearest level a
// family actually supports. `none` and `off` both sit at 0 — they represent
// "no reasoning" for different vendors. Ties prefer the lower (more
// conservative) supported level.
const EFFORT_ORDINAL: Record<EffortLevel, number> = {
  none: 0,
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
  ultracode: 6,
};

function isClaudeFamily(family: ModelFamily): boolean {
  return family === "claude-haiku" || family === "claude-sonnet" || family === "claude-opus";
}

function nearestSupportedEffort(family: ModelFamily, effort: ThinkingLevel): ThinkingLevel {
  if (isEffortSupported(family, effort)) return effort;
  const supported = FAMILY_EFFORTS[family];
  const target = EFFORT_ORDINAL[effort];
  let best: ThinkingLevel = supported[0]!;
  let bestDistance = Math.abs(EFFORT_ORDINAL[best] - target);
  for (const candidate of supported) {
    const d = Math.abs(EFFORT_ORDINAL[candidate] - target);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
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

// Same-family preservation guard for the terminal claude-code provider.
//
// Invariant: when the requested family is a Claude family and we select
// claude-code, the resolved family must equal the requested family and the
// resolved effort must lie inside that family's supported set
// (nearest-clamped if the request is out of set). A cross-Claude-family
// downgrade is allowed only if the tier entry is explicitly marked
// `relationship: "downgrade"` AND routing.allowDowngrade is true. This holds
// even if a user edits the routing table.
function applyClaudeCodeFamilyGuard(
  entry: TierEntry,
  requestedFamily: ModelFamily,
  requestedEffort: ThinkingLevel,
  allowDowngrade: boolean,
): { entry: TierEntry; relationship: Relationship } {
  if (!isClaudeFamily(requestedFamily)) {
    return {
      entry,
      relationship: classifyRelationship(entry, requestedFamily, requestedEffort),
    };
  }

  if (entry.family !== requestedFamily) {
    // Cross-Claude-family entry: only honour an explicit, permitted downgrade.
    if (allowDowngrade && entry.relationship === "downgrade") {
      return { entry, relationship: "downgrade" };
    }
    // Otherwise force back to the requested Claude family with clamped effort.
    const clamped = nearestSupportedEffort(requestedFamily, requestedEffort);
    return {
      entry: { family: requestedFamily, effort: clamped },
      relationship: clamped === requestedEffort ? "exact" : "equivalent",
    };
  }

  // Same family — preserve family, use the requested effort clamped to the
  // family's supported set.
  const clamped = nearestSupportedEffort(requestedFamily, requestedEffort);
  return {
    entry: { family: requestedFamily, effort: clamped },
    relationship: clamped === requestedEffort ? "exact" : "equivalent",
  };
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
  securityFilter?: SecurityFilter,
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
  const skippedForSecurity: Array<{ provider: ProviderId; reason: string }> = [];

  for (const provider of routing.providerPriority) {
    const rawEntry = tierEntries?.[provider];
    if (!rawEntry) continue;

    const providerEntry = providerCfg.providers[provider];
    if (!providerEntry?.enabled) continue;

    let entry: TierEntry = rawEntry;
    let relationship: Relationship;

    if (provider === "claude-code") {
      const guarded = applyClaudeCodeFamilyGuard(
        rawEntry,
        requestedFamily,
        request.effort,
        routing.allowDowngrade,
      );
      entry = guarded.entry;
      relationship = guarded.relationship;
    } else {
      relationship = classifyRelationship(rawEntry, requestedFamily, request.effort);
    }

    if (
      requestedFamily === "claude-opus" &&
      !routing.allowDowngrade &&
      (relationship === "downgrade" || relationship === "no_equivalent")
    ) {
      continue;
    }

    const concrete = resolveConcrete(provider, entry, providerCfg);
    if (!concrete) continue;

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

    return finalize(
      {
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
      },
      skippedForSecurity,
    );
  }

  // Terminal: enabled gate intentionally does not apply here. claude-code is the
  // guaranteed baseline so resolveModel stays total regardless of its enabled flag.
  // Try the tier's claude-code entry first, then a direct claude-code/<requestedFamily> resolution.
  const terminalTierEntry = tierEntries?.["claude-code"];
  if (terminalTierEntry) {
    const guarded = applyClaudeCodeFamilyGuard(
      terminalTierEntry,
      requestedFamily,
      request.effort,
      routing.allowDowngrade,
    );
    const concrete = resolveConcrete("claude-code", guarded.entry, providerCfg);
    if (concrete) {
      return finalize(
        {
          requested: {
            model: request.model,
            family: requestedFamily,
            effort: request.effort,
          },
          normalizedTier: tier,
          selected: buildSelected(
            "claude-code",
            guarded.entry.family,
            concrete.thinking,
            concrete.concreteModel,
          ),
          relationship: guarded.relationship,
          reason: reasonFor(
            request,
            requestedFamily,
            familyResolution.source,
            tier,
            "claude-code",
            guarded.entry.family,
            concrete.thinking,
            guarded.relationship,
            true,
          ),
        },
        skippedForSecurity,
      );
    }
  }

  const directModel = providerCfg.providers["claude-code"]?.families?.[requestedFamily]?.model;
  if (directModel) {
    const directEffort = isClaudeFamily(requestedFamily)
      ? nearestSupportedEffort(requestedFamily, request.effort)
      : request.effort;
    const relationship: Relationship = directEffort === request.effort ? "exact" : "equivalent";
    return finalize(
      {
        requested: {
          model: request.model,
          family: requestedFamily,
          effort: request.effort,
        },
        normalizedTier: tier,
        selected: buildSelected("claude-code", requestedFamily, directEffort, directModel),
        relationship,
        reason: `No tier entry available for ${tier}; routed directly to claude-code/${requestedFamily}/${directEffort}.`,
      },
      skippedForSecurity,
    );
  }

  const sonnetFallback =
    providerCfg.providers["claude-code"]?.families?.["claude-sonnet"]?.model ?? "claude-sonnet";
  const sonnetEffort = nearestSupportedEffort("claude-sonnet", request.effort);
  return finalize(
    {
      requested: {
        model: request.model,
        family: requestedFamily,
        effort: request.effort,
      },
      normalizedTier: tier,
      selected: buildSelected("claude-code", "claude-sonnet", sonnetEffort, sonnetFallback),
      relationship: "no_equivalent",
      reason: `No matching provider for tier ${tier}; defaulted to claude-code/claude-sonnet.`,
    },
    skippedForSecurity,
  );
}
