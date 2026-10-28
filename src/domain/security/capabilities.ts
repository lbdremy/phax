import type { ProviderId, SecurityFilter } from "../routing/types.js";
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
    filesystemJail: "strong",
    mcpAllowlist: "supported",
    commandEnforcement: "prefix",
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

  // A strong filesystem jail is the only hard gate for strict-secure. Network is
  // governed by profile alone (no domain allowlist exists for any provider), and
  // MCP gaps surface as marks rather than blocking the run.
  const satisfiesStrict = cap.filesystemJail === "strong";

  const downgraded = !satisfiesStrict;

  return { provider, satisfiesStrict, downgraded, marks, notes };
}

/**
 * The routing filter `phax run` applies for `policy`: every provider outside
 * secure mode, and in secure mode only a provider that satisfies it strictly.
 * Shared with `phax plans estimate` so both route a phase the same way.
 */
export function securityFilterFor(policy: SecurityPolicy): SecurityFilter {
  return (provider) => {
    if (policy.mode !== "secure") {
      return { allowed: true };
    }
    const evaluation = evaluateProviderSecurity(provider, policy);
    return evaluation.satisfiesStrict
      ? { allowed: true }
      : {
          allowed: false,
          reason: evaluation.marks.length
            ? `cannot satisfy strict secure mode (${evaluation.marks.join(", ")})`
            : "cannot satisfy strict secure mode",
        };
  };
}
