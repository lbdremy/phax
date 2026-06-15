export type SecurityMode = "secure" | "unsafe" | "isolated";
export type NetworkProfile = "provider-only" | "dev-allowlist" | "open";
export type McpMode = "disabled" | "local-only" | "allowlist" | "provider-default";

export interface SecurityPolicy {
  readonly mode: SecurityMode;
  readonly filesystem: {
    readonly allowRead: readonly string[];
    readonly allowWrite: readonly string[];
  };
  readonly network: { readonly profile: NetworkProfile };
  readonly mcp: { readonly mode: McpMode; readonly allow: readonly string[] };
  readonly agentCommands: readonly string[];
  readonly failClosed: boolean;
}
