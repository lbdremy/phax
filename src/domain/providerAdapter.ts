import type { ProviderId } from "./routing/types.js";

export type AdapterId = "claude" | "codex" | "mistral";

export function providerToAdapter(provider: ProviderId): AdapterId {
  switch (provider) {
    case "claude-code":
      return "claude";
    case "codex-cli":
      return "codex";
    case "mistral-vibe":
      return "mistral";
  }
}
