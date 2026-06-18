import type { ProviderId } from "../../domain/routing/types.js";
import type { SessionAdapter } from "./types.js";
import { claudeSessionAdapter } from "./claude.js";
import { codexSessionAdapter } from "./codex.js";
import { mistralSessionAdapter } from "./mistral.js";

export type { SessionAdapter };

export function getSessionAdapter(provider: ProviderId): SessionAdapter {
  switch (provider) {
    case "claude-code":
      return claudeSessionAdapter;
    case "codex-cli":
      return codexSessionAdapter;
    case "mistral-vibe":
      return mistralSessionAdapter;
  }
}
