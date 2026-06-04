import type { ProviderId } from "../routing/types.js";

export type SecurityMode = "secure" | "unsafe" | "isolated";
export type NetworkProfile = "provider-only" | "dev-allowlist" | "open";
export type McpMode = "disabled" | "local-only" | "allowlist" | "provider-default";

export interface SecurityPolicy {
  readonly mode: SecurityMode;
  readonly filesystem: {
    readonly allowRead: readonly string[];
    readonly allowWrite: readonly string[];
  };
  readonly network: { readonly profile: NetworkProfile; readonly allowDomains: readonly string[] };
  readonly mcp: { readonly mode: McpMode; readonly allow: readonly string[] };
  readonly failClosed: boolean;
}

export const PROVIDER_API_DOMAINS: Record<ProviderId, string> = {
  "claude-code": "api.anthropic.com",
  "codex-cli": "api.openai.com",
  "mistral-vibe": "api.mistral.ai",
};
