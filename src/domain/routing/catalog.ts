import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { CatalogEntry, ProviderConfig } from "../../schemas/providerConfig.js";
import type { ModelFamily, ProviderId, Relationship, ThinkingLevel } from "./types.js";

// Ordinal positions used to compute nearest-effort alternatives. `none` and
// `off` both sit at 0 — they represent "no reasoning" for different vendors.
// Ties prefer the lower (more conservative) supported level.
const EFFORT_ORDINAL: Record<ThinkingLevel, number> = {
  none: 0,
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
  ultracode: 6,
};

export interface CatalogLocation {
  readonly provider: ProviderId;
  readonly family: ModelFamily;
  readonly entry: CatalogEntry;
}

// Enumerate every (provider, family, entry) tuple in the catalog. The provider
// key is asserted as ProviderId because the ProviderConfig type keys `providers`
// with plain strings (loosened at the schema boundary); every id we ship is a
// concrete ProviderId.
function* catalogEntries(providerCfg: ProviderConfig): Generator<CatalogLocation> {
  for (const [provider, providerEntry] of Object.entries(providerCfg.providers)) {
    const families = providerEntry.families;
    if (!families) continue;
    for (const [family, familyEntry] of Object.entries(families)) {
      for (const entry of familyEntry.models) {
        yield {
          provider: provider as ProviderId,
          family: family as ModelFamily,
          entry,
        };
      }
    }
  }
}

/**
 * Return the {@link ModelFamily} that owns a concrete versioned model id, or
 * undefined when the id is not present in the catalog. Iteration order follows
 * the provider config; the first match wins.
 */
export function familyOfId(id: string, providerCfg: ProviderConfig): ModelFamily | undefined {
  for (const location of catalogEntries(providerCfg)) {
    if (location.entry.id === id) return location.family;
  }
  return undefined;
}

/**
 * Return the {@link CatalogLocation} for a concrete versioned model id, or
 * undefined when the id is not in the catalog.
 */
export function entryFor(id: string, providerCfg: ProviderConfig): CatalogLocation | undefined {
  for (const location of catalogEntries(providerCfg)) {
    if (location.entry.id === id) return location;
  }
  return undefined;
}

/**
 * Return the efforts a specific catalog entry supports, or undefined when the
 * id is not in the catalog. Efforts are per entry (per version), not per
 * family.
 */
export function effortsFor(
  id: string,
  providerCfg: ProviderConfig,
): ReadonlyArray<ThinkingLevel> | undefined {
  return entryFor(id, providerCfg)?.entry.efforts;
}

/**
 * True when the catalog entry with this id is marked `deprecated`.
 */
export function isDeprecated(id: string, providerCfg: ProviderConfig): boolean {
  return entryFor(id, providerCfg)?.entry.status === "deprecated";
}

/**
 * Return the efforts a catalog entry supports, ordered by proximity to
 * `requestedEffort` (nearest first). Empty when the id is not in the catalog.
 * Used by the preflight to build actionable alternatives; not consulted by
 * resolveModel itself.
 */
export function nearestEfforts(
  id: string,
  requestedEffort: ThinkingLevel,
  providerCfg: ProviderConfig,
): ReadonlyArray<ThinkingLevel> {
  const efforts = effortsFor(id, providerCfg);
  if (!efforts || efforts.length === 0) return [];
  const target = EFFORT_ORDINAL[requestedEffort];
  return efforts.toSorted((a, b) => {
    const da = Math.abs(EFFORT_ORDINAL[a] - target);
    const db = Math.abs(EFFORT_ORDINAL[b] - target);
    if (da !== db) return da - db;
    return EFFORT_ORDINAL[a] - EFFORT_ORDINAL[b];
  });
}

const RELATION_INVERSE: Record<Relationship, Relationship> = {
  exact: "exact",
  equivalent: "equivalent",
  upgrade: "downgrade",
  downgrade: "upgrade",
  fallback: "fallback",
  no_equivalent: "no_equivalent",
};

function invertRelation(rel: Relationship): Relationship {
  return RELATION_INVERSE[rel];
}

function composeRelations(a: Relationship, b: Relationship): Relationship {
  if (a === "no_equivalent" || b === "no_equivalent") return "no_equivalent";
  if (a === "fallback" || b === "fallback") return "fallback";
  if (a === "downgrade" || b === "downgrade") return "downgrade";
  if (a === "upgrade" || b === "upgrade") return "upgrade";
  if (a === "exact") return b;
  if (b === "exact") return a;
  return "equivalent";
}

const CLAUDE_FAMILIES: readonly ModelFamily[] = ["claude-haiku", "claude-sonnet", "claude-opus"];

export function isClaudeFamily(family: ModelFamily): boolean {
  return CLAUDE_FAMILIES.includes(family);
}

export interface EquivalentSubstitution {
  readonly id: string;
  readonly effort: ThinkingLevel;
  readonly relation: Relationship;
}

/**
 * Look up the equivalent catalog entry in `targetFamily` for a concrete
 * `(id, effort)` request, using the Claude-hub star. Returns undefined when no
 * edge exists.
 *
 * Semantics:
 * - hub → spoke: search the equivalence table for an entry whose canonical
 *   {claude, effort} matches the request AND whose spoke id belongs to
 *   `targetFamily`. Return that spoke entry with the stored relation.
 * - spoke → hub: direct lookup `equivalence[id][effort]`; invert the relation.
 * - spoke → spoke: compose the two hops through the Claude hub.
 */
export function equivalentFor(
  id: string,
  effort: ThinkingLevel,
  targetFamily: ModelFamily,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
): EquivalentSubstitution | undefined {
  const sourceLocation = entryFor(id, providerCfg);
  const sourceFamily = sourceLocation?.family;
  if (!sourceFamily) return undefined;
  if (sourceFamily === targetFamily) return undefined;

  const sourceIsClaude = isClaudeFamily(sourceFamily);
  const targetIsClaude = isClaudeFamily(targetFamily);

  if (sourceIsClaude && !targetIsClaude) {
    return hubToSpoke(id, effort, targetFamily, routing, providerCfg);
  }
  if (!sourceIsClaude && targetIsClaude) {
    return spokeToHub(id, effort, targetFamily, routing, providerCfg);
  }
  if (!sourceIsClaude && !targetIsClaude) {
    // Route spoke1 → hub → spoke2, composing the two relations.
    const toHub = spokeToHubAny(id, effort, routing, providerCfg);
    if (!toHub) return undefined;
    const toSpoke = hubToSpoke(toHub.id, toHub.effort, targetFamily, routing, providerCfg);
    if (!toSpoke) return undefined;
    return {
      id: toSpoke.id,
      effort: toSpoke.effort,
      relation: composeRelations(toHub.relation, toSpoke.relation),
    };
  }
  // sourceIsClaude && targetIsClaude — cross-Claude-family is not translated
  // through the equivalence table (Claude ↔ Claude is same-hub, resolved
  // natively by the caller). Reserved for future use.
  return undefined;
}

function hubToSpoke(
  claudeId: string,
  claudeEffort: ThinkingLevel,
  targetFamily: ModelFamily,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
): EquivalentSubstitution | undefined {
  for (const [spokeId, byEffort] of Object.entries(routing.equivalence)) {
    const spokeLocation = entryFor(spokeId, providerCfg);
    if (!spokeLocation || spokeLocation.family !== targetFamily) continue;
    for (const [spokeEffort, edge] of Object.entries(byEffort)) {
      if (edge.claude === claudeId && edge.effort === claudeEffort) {
        return {
          id: spokeId,
          effort: spokeEffort as ThinkingLevel,
          relation: edge.relation,
        };
      }
    }
  }
  return undefined;
}

function spokeToHub(
  spokeId: string,
  spokeEffort: ThinkingLevel,
  targetFamily: ModelFamily,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
): EquivalentSubstitution | undefined {
  const edge = routing.equivalence[spokeId]?.[spokeEffort];
  if (!edge) return undefined;
  const claudeLocation = entryFor(edge.claude, providerCfg);
  if (!claudeLocation || claudeLocation.family !== targetFamily) return undefined;
  return {
    id: edge.claude,
    effort: edge.effort,
    relation: invertRelation(edge.relation),
  };
}

function spokeToHubAny(
  spokeId: string,
  spokeEffort: ThinkingLevel,
  routing: ModelRouting,
  providerCfg: ProviderConfig,
): EquivalentSubstitution | undefined {
  const edge = routing.equivalence[spokeId]?.[spokeEffort];
  if (!edge) return undefined;
  const claudeLocation = entryFor(edge.claude, providerCfg);
  if (!claudeLocation) return undefined;
  return {
    id: edge.claude,
    effort: edge.effort,
    relation: invertRelation(edge.relation),
  };
}
