import { Schema } from "effect";
import type { SecurityMode, NetworkProfile, McpMode } from "../domain/security/types.js";

export const SecurityProfileSchema = Schema.Literal("secure", "unsafe", "isolated");
export const NetworkProfileSchema = Schema.Literal("provider-only", "dev-allowlist", "open");
export const McpModeSchema = Schema.Literal(
  "disabled",
  "local-only",
  "allowlist",
  "provider-default",
);

const FilesystemConfigSchema = Schema.Struct({
  allowRead: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  allowWrite: Schema.optional(Schema.Array(Schema.NonEmptyString)),
});

const NetworkConfigSchema = Schema.Struct({
  profile: Schema.optional(NetworkProfileSchema),
  allowDomains: Schema.optional(Schema.Array(Schema.NonEmptyString)),
});

const McpConfigSchema = Schema.Struct({
  mode: Schema.optional(McpModeSchema),
  allow: Schema.optional(Schema.Array(Schema.NonEmptyString)),
});

export const SecurityConfigSchema = Schema.Struct({
  profile: Schema.optional(SecurityProfileSchema),
  filesystem: Schema.optional(FilesystemConfigSchema),
  network: Schema.optional(NetworkConfigSchema),
  mcp: Schema.optional(McpConfigSchema),
});

export type SecurityConfig = Schema.Schema.Type<typeof SecurityConfigSchema>;

export const DEFAULT_SECURITY_PROFILE: SecurityMode = "unsafe";

export interface ResolvedSecurityConfig {
  readonly profile: SecurityMode;
  readonly filesystem: {
    readonly allowRead: readonly string[];
    readonly allowWrite: readonly string[];
  };
  readonly network: {
    readonly profile: NetworkProfile;
    readonly allowDomains: readonly string[];
  };
  readonly mcp: {
    readonly mode: McpMode;
    readonly allow: readonly string[];
  };
}

export function resolveSecurityConfig(
  raw: SecurityConfig | undefined,
  defaultProfile: SecurityMode,
): ResolvedSecurityConfig {
  return {
    profile: raw?.profile ?? defaultProfile,
    filesystem: {
      allowRead: raw?.filesystem?.allowRead ?? [],
      allowWrite: raw?.filesystem?.allowWrite ?? [],
    },
    network: {
      profile: raw?.network?.profile ?? "provider-only",
      allowDomains: raw?.network?.allowDomains ?? [],
    },
    mcp: {
      mode: raw?.mcp?.mode ?? "disabled",
      allow: raw?.mcp?.allow ?? [],
    },
  };
}
