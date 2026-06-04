import type { ProviderId } from "../routing/types.js";
import type { SecurityPolicy } from "./types.js";

export type JailStrength = "strong" | "partial" | "none";
export type CapabilitySupport = "supported" | "unsupported";

export interface ProviderSecurityCapability {
  readonly filesystemJail: JailStrength;
  readonly networkAllowlist: CapabilitySupport;
  readonly mcpAllowlist: CapabilitySupport;
}

export const PROVIDER_SECURITY_CAPABILITIES: Record<ProviderId, ProviderSecurityCapability> = {
  "claude-code": {
    filesystemJail: "strong",
    networkAllowlist: "supported",
    mcpAllowlist: "supported",
  },
  "codex-cli": {
    filesystemJail: "strong",
    networkAllowlist: "supported",
    mcpAllowlist: "supported",
  },
  "mistral-vibe": {
    filesystemJail: "partial",
    networkAllowlist: "unsupported",
    mcpAllowlist: "supported",
  },
};

export type SecurityMark = "partial-filesystem" | "network-unenforced" | "mcp-unenforced";

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

  if (cap.networkAllowlist === "unsupported") {
    marks.push("network-unenforced");
  }

  if (provider === "mistral-vibe" && marks.length > 0) {
    notes.push(VIBE_PARTIAL_SECURED_MESSAGE);
  }

  const satisfiesStrict =
    cap.filesystemJail === "strong" &&
    (policy.network.profile === "provider-only" || cap.networkAllowlist === "supported");

  const downgraded = !satisfiesStrict;

  return { provider, satisfiesStrict, downgraded, marks, notes };
}
