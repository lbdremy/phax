import { join } from "node:path";

/**
 * Where each provider keeps its own session store: Claude Code's config
 * directory, codex's home and vibe's home. Null means no store is known, so
 * nothing is read from it.
 */
export interface ProviderStoreRootsValue {
  readonly claude: string | null;
  readonly codex: string | null;
  readonly vibe: string | null;
}

export const NO_PROVIDER_STORE_ROOTS: ProviderStoreRootsValue = {
  claude: null,
  codex: null,
  vibe: null,
};

/**
 * Each provider's own variable when it is set and non-empty, else its
 * default under `home`: `CLAUDE_CONFIG_DIR` or `<home>/.claude`, `CODEX_HOME`
 * or `<home>/.codex`, `VIBE_HOME` or `<home>/.vibe`. An empty home gives no
 * default root.
 */
export function resolveProviderStoreRoots(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): ProviderStoreRootsValue {
  const root = (variable: string, folder: string): string | null => {
    const value = env[variable];
    if (value !== undefined && value !== "") return value;
    return home === "" ? null : join(home, folder);
  };
  return {
    claude: root("CLAUDE_CONFIG_DIR", ".claude"),
    codex: root("CODEX_HOME", ".codex"),
    vibe: root("VIBE_HOME", ".vibe"),
  };
}
