import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { CatalogEntry, ProviderConfig } from "../../schemas/providerConfig.js";
import {
  DEFAULT_PROVIDER_CONFIG,
  RETIRED_MODEL_IDS,
  RETIRED_MODEL_SUCCESSORS,
} from "./defaults.js";

export interface ProviderProbeResult {
  readonly provider: string;
  readonly available: boolean;
}

export interface ProviderConfigPlan {
  readonly config: ProviderConfig;
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
  readonly unchanged: readonly string[];
  /** Retired catalog ids the current config listed, dropped from the plan's config. */
  readonly retiredRemoved: readonly string[];
  /**
   * The successor ids the plan lists in place of retired ones, each once, in config order. A
   * successor a family already listed is not here: the plan added nothing.
   */
  readonly retiredReplaced: readonly string[];
  /** Dotted paths of the fields the file carried and phax no longer reads, dropped from the plan's config. */
  readonly fieldsDropped: readonly string[];
}

/** A field phax no longer reads, found in a raw providers.json: where, and why. */
export interface ObsoleteProviderField {
  readonly path: string;
  readonly reason: string;
}

const OBSOLETE_PROVIDER_FIELDS: Readonly<Record<string, string>> = {
  modelEnvVar: "phax picks the Vibe model with --model",
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Every `providers.<key>.<field>` of a raw (not yet decoded) providers.json that phax no longer
 * reads, in file order. Anything that is not a `providers` object of objects has none: the
 * strict decode reports that.
 */
export function obsoleteProviderFields(raw: unknown): readonly ObsoleteProviderField[] {
  if (!isPlainObject(raw) || !isPlainObject(raw["providers"])) return [];
  return Object.entries(raw["providers"]).flatMap(([key, entry]) =>
    isPlainObject(entry)
      ? Object.entries(OBSOLETE_PROVIDER_FIELDS)
          .filter(([field]) => field in entry)
          .map(([field, reason]) => ({ path: `providers.${key}.${field}`, reason }))
      : [],
  );
}

/** `raw` with the fields `obsoleteProviderFields` reports removed; anything else comes back as it is. */
export function withoutObsoleteProviderFields(raw: unknown): unknown {
  if (!isPlainObject(raw) || !isPlainObject(raw["providers"])) return raw;
  const providers: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(raw["providers"])) {
    providers[key] = isPlainObject(entry)
      ? Object.fromEntries(
          Object.entries(entry).filter(([field]) => !(field in OBSOLETE_PROVIDER_FIELDS)),
        )
      : entry;
  }
  return { ...raw, providers };
}

/** The equivalence keys of `routing` that name a retired catalog id (`RETIRED_MODEL_IDS`). */
export function retiredEquivalenceKeys(routing: ModelRouting): readonly string[] {
  return Object.keys(routing.equivalence).filter((key) => key in RETIRED_MODEL_IDS);
}

/** The ids of `config` that phax no longer routes to (`RETIRED_MODEL_IDS`), in config order. */
export function retiredModelIds(config: ProviderConfig): readonly string[] {
  return Object.values(config.providers).flatMap((entry) =>
    Object.values(entry.families ?? {}).flatMap((family) =>
      family.models.map((m) => m.id).filter((id) => id in RETIRED_MODEL_IDS),
    ),
  );
}

type ProviderEntry = ProviderConfig["providers"][string];
type FamilyEntry = NonNullable<ProviderEntry["families"]>[string];

/**
 * `entry` with every retired catalog id dropped, and any family it empties with them. Where a
 * dropped id has a successor, the successor's built-in catalog entry (same provider and family)
 * is listed where the first such retired id stood, unless the family already lists it.
 * `replaced` is the successor ids so listed.
 */
function withoutRetiredModels(
  providerKey: string,
  entry: ProviderEntry,
): { readonly entry: ProviderEntry; readonly replaced: readonly string[] } {
  if (entry.families === undefined) return { entry, replaced: [] };
  const families: Record<string, FamilyEntry> = {};
  const replaced: string[] = [];
  for (const [name, family] of Object.entries(entry.families)) {
    const builtIn = DEFAULT_PROVIDER_CONFIG.providers[providerKey]?.families?.[name]?.models ?? [];
    const listed = new Set(family.models.map((m) => m.id));
    const kept: CatalogEntry[] = [];
    for (const model of family.models) {
      if (!(model.id in RETIRED_MODEL_IDS)) {
        kept.push(model);
        continue;
      }
      const successorId = RETIRED_MODEL_SUCCESSORS[model.id];
      const successor = builtIn.find((m) => m.id === successorId);
      if (successor === undefined || listed.has(successor.id)) continue;
      listed.add(successor.id);
      kept.push(successor);
      replaced.push(successor.id);
    }
    const [first, ...rest] = kept;
    if (first !== undefined) families[name] = { ...family, models: [first, ...rest] };
  }
  return { entry: { ...entry, families }, replaced };
}

export function planProviderConfig(
  current: ProviderConfig,
  probes: readonly ProviderProbeResult[],
  opts: { readonly prune: boolean; readonly fieldsDropped: readonly string[] },
): ProviderConfigPlan {
  const probeMap = new Map(probes.map((p) => [p.provider, p.available]));

  const enabled: string[] = [];
  const disabled: string[] = [];
  const unchanged: string[] = [];
  const retiredReplaced = new Set<string>();
  const newProviders: Record<string, ProviderConfig["providers"][string]> = {};

  for (const [key, listed] of Object.entries(current.providers)) {
    const available = probeMap.get(key);
    const { entry, replaced } = withoutRetiredModels(key, listed);
    for (const id of replaced) retiredReplaced.add(id);

    if (available === true && !entry.enabled) {
      newProviders[key] = { ...entry, enabled: true };
      enabled.push(key);
    } else if (available === false && entry.enabled && opts.prune) {
      newProviders[key] = { ...entry, enabled: false };
      disabled.push(key);
    } else {
      newProviders[key] = entry;
      unchanged.push(key);
    }
  }

  return {
    config: { providers: newProviders },
    enabled,
    disabled,
    unchanged,
    retiredRemoved: retiredModelIds(current),
    retiredReplaced: [...retiredReplaced],
    fieldsDropped: opts.fieldsDropped,
  };
}
