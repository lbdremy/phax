import { Layer } from "effect";
import { join } from "node:path";
import type { ProviderStoreRootsValue } from "../../src/domain/session/storeRoots.js";
import { ProviderStoreRoots } from "../../src/ports/providerStores.js";

/** The provider store roots a provider would use with HOME at `home` and none of its variables set. */
export function rootsUnder(home: string): ProviderStoreRootsValue {
  return {
    claude: join(home, ".claude"),
    codex: join(home, ".codex"),
  };
}

/** Provide the store roots under a test's own HOME, so a suite reads only its own stores. */
export function providerStoreRootsUnder(home: string): Layer.Layer<ProviderStoreRoots> {
  return Layer.succeed(ProviderStoreRoots, rootsUnder(home));
}

const PROVIDER_STORE_VARIABLES = ["CLAUDE_CONFIG_DIR", "CODEX_HOME"] as const;

/**
 * The environment for a phax CLI process a test starts: `process.env` with HOME
 * at `home`, `extra` merged over it, and the two provider store variables
 * deleted, so a developer's or CI's stores never reach it.
 */
export function childEnvUnder(
  home: string,
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ...extra };
  for (const variable of PROVIDER_STORE_VARIABLES) delete env[variable];
  return env;
}
