import type { ProviderId } from "../../schemas/providerId.js";
import type { UserConfig } from "../../schemas/runRecord.js";

/**
 * Whether a phase's headless sessions loaded the operator's user-level provider
 * configuration, as its record says. Total over `ProviderId`.
 *
 * Headless Claude Code sessions launch project-only (`excluded`); Codex and
 * Mistral Vibe still load the user layer (`loaded`).
 */
export function userConfigOf(provider: ProviderId): UserConfig {
  switch (provider) {
    case "claude-code":
      return "excluded";
    case "codex-cli":
      return "loaded";
    case "mistral-vibe":
      return "loaded";
  }
}
