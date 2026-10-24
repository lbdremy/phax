import { Layer } from "effect";
import { homedir } from "node:os";
import { resolveProviderStoreRoots } from "../domain/session/storeRoots.js";
import { ProviderStoreRoots } from "../ports/providerStores.js";

/**
 * The provider store roots of this invocation, from the environment and the
 * home directory. The only code that reads `CLAUDE_CONFIG_DIR`, `CODEX_HOME`
 * and `VIBE_HOME`.
 */
export const ProviderStoreRootsLive: Layer.Layer<ProviderStoreRoots> = Layer.sync(
  ProviderStoreRoots,
  () => resolveProviderStoreRoots(process.env, homedir()),
);
