import type { ProviderId } from "../routing/types.js";
import type { ResolvedSecurityConfig } from "../../schemas/securityConfig.js";
import { type SecurityMode, type SecurityPolicy, PROVIDER_API_DOMAINS } from "./types.js";

export interface ResolvePolicyInput {
  readonly mode: SecurityMode;
  readonly provider: ProviderId;
  readonly worktreePath: string;
  readonly stateRoot: string;
  readonly config: ResolvedSecurityConfig;
}

function dedupe(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)];
}

export function resolveSecurityPolicy(input: ResolvePolicyInput): SecurityPolicy {
  const { mode, provider, worktreePath, stateRoot, config } = input;

  if (mode === "unsafe") {
    return {
      mode: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: config.network.profile, allowDomains: [] },
      mcp: { mode: config.mcp.mode, allow: [] },
      failClosed: false,
    };
  }

  // secure (and isolated — treated like secure for type totality; the CLI
  // gates isolated before a run starts, so this branch is only reached in tests
  // or if the caller bypasses the CLI gate)
  const allowWrite = dedupe([worktreePath, stateRoot, ...config.filesystem.allowWrite]);
  const allowRead = dedupe([...allowWrite, ...config.filesystem.allowRead]);

  const providerDomain = PROVIDER_API_DOMAINS[provider];
  const networkProfile = config.network.profile;
  const allowDomains =
    networkProfile === "provider-only"
      ? [providerDomain]
      : dedupe([providerDomain, ...config.network.allowDomains]);

  return {
    mode,
    filesystem: { allowRead, allowWrite },
    network: { profile: networkProfile, allowDomains },
    mcp: { mode: config.mcp.mode, allow: config.mcp.allow },
    failClosed: true,
  };
}
