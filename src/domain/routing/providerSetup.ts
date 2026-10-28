import type { ProviderConfig } from "../../schemas/providerConfig.js";
import { RETIRED_MODEL_IDS } from "./defaults.js";

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

/** `entry` with every retired catalog id dropped, and any family it empties with them. */
function withoutRetiredModels(entry: ProviderEntry): ProviderEntry {
  if (entry.families === undefined) return entry;
  const families: Record<string, FamilyEntry> = {};
  for (const [name, family] of Object.entries(entry.families)) {
    const [first, ...rest] = family.models.filter((m) => !(m.id in RETIRED_MODEL_IDS));
    if (first !== undefined) families[name] = { ...family, models: [first, ...rest] };
  }
  return { ...entry, families };
}

export function planProviderConfig(
  current: ProviderConfig,
  probes: readonly ProviderProbeResult[],
  opts: { readonly prune: boolean },
): ProviderConfigPlan {
  const probeMap = new Map(probes.map((p) => [p.provider, p.available]));

  const enabled: string[] = [];
  const disabled: string[] = [];
  const unchanged: string[] = [];
  const newProviders: Record<string, ProviderConfig["providers"][string]> = {};

  for (const [key, listed] of Object.entries(current.providers)) {
    const available = probeMap.get(key);
    const entry = withoutRetiredModels(listed);

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
  };
}
