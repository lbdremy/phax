import type { ProviderConfig } from "../../schemas/providerConfig.js";

export interface ProviderProbeResult {
  readonly provider: string;
  readonly available: boolean;
}

export interface ProviderConfigPlan {
  readonly config: ProviderConfig;
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
  readonly unchanged: readonly string[];
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

  for (const [key, entry] of Object.entries(current.providers)) {
    const available = probeMap.get(key);

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
  };
}
