import type { ProviderId } from "../../schemas/providerId.js";
import type { UserConfig } from "../../schemas/runRecord.js";

/**
 * Whether a phase's headless sessions loaded the operator's user-level provider
 * configuration, as its record says. Total over `ProviderId`.
 *
 * Every launch still loads the user layer at this commit, so every provider is
 * `loaded`. The claude-code case becomes `excluded` once headless Claude Code
 * sessions launch project-only.
 */
export function userConfigOf(provider: ProviderId): UserConfig {
  switch (provider) {
    case "claude-code":
      return "loaded";
    case "codex-cli":
      return "loaded";
    case "mistral-vibe":
      return "loaded";
  }
}
