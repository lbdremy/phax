import type { ProviderId } from "../routing/types.js";
import type { SecurityPolicy } from "./types.js";

export type JailStrength = "strong" | "partial" | "none";
export type CapabilitySupport = "supported" | "unsupported";
export type CommandEnforcement = "exact" | "prefix" | "executable" | "none";

export interface ProviderSecurityCapability {
  readonly filesystemJail: JailStrength;
  readonly mcpAllowlist: CapabilitySupport;
  readonly commandEnforcement: CommandEnforcement;
}

export const PROVIDER_SECURITY_CAPABILITIES: Record<ProviderId, ProviderSecurityCapability> = {
  "claude-code": {
    filesystemJail: "strong",
    mcpAllowlist: "supported",
    commandEnforcement: "prefix",
  },
  "codex-cli": {
    filesystemJail: "strong",
    mcpAllowlist: "supported",
    commandEnforcement: "none",
  },
  "mistral-vibe": {
    filesystemJail: "partial",
    mcpAllowlist: "supported",
    commandEnforcement: "none",
  },
};

export type SecurityMark = "partial-filesystem" | "mcp-unenforced";

export interface SecurityEvaluation {
  readonly provider: ProviderId;
  readonly satisfiesStrict: boolean;
  readonly downgraded: boolean;
  readonly marks: readonly SecurityMark[];
  readonly notes: readonly string[];
}

export const VIBE_PARTIAL_SECURED_MESSAGE =
  "Mistral Vibe is running with provider-native restrictions, but filesystem/network isolation is weaker than Claude Code or Codex. For stronger isolation, use the future external-sandbox mode.";

export function evaluateProviderSecurity(
  provider: ProviderId,
  policy: SecurityPolicy,
): SecurityEvaluation {
  if (policy.mode !== "secure") {
    return { provider, satisfiesStrict: true, downgraded: false, marks: [], notes: [] };
  }

  const cap = PROVIDER_SECURITY_CAPABILITIES[provider];
  const marks: SecurityMark[] = [];
  const notes: string[] = [];

  if (cap.filesystemJail !== "strong") {
    marks.push("partial-filesystem");
  }

  if (provider === "mistral-vibe" && marks.length > 0) {
    notes.push(VIBE_PARTIAL_SECURED_MESSAGE);
  }

  // A strong filesystem jail is the only hard gate for strict-secure. Network is
  // governed by profile alone (no domain allowlist exists for any provider), and
  // MCP gaps surface as marks rather than blocking the run.
  const satisfiesStrict = cap.filesystemJail === "strong";

  const downgraded = !satisfiesStrict;

  return { provider, satisfiesStrict, downgraded, marks, notes };
}
