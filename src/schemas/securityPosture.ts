import { Schema } from "effect";
import { ProviderIdSchema } from "./modelRouting.js";
import { NetworkProfileSchema, McpModeSchema } from "./securityConfig.js";

export const SecurityPostureSchema = Schema.Struct({
  version: Schema.Literal(1),
  mode: Schema.Literal("secure", "unsafe", "isolated"),
  provider: ProviderIdSchema,
  sandboxEnabled: Schema.Boolean,
  filesystem: Schema.Struct({
    allowRead: Schema.Array(Schema.NonEmptyString),
    allowWrite: Schema.Array(Schema.NonEmptyString),
  }),
  network: Schema.Struct({
    profile: NetworkProfileSchema,
    allowDomains: Schema.Array(Schema.NonEmptyString),
  }),
  mcp: Schema.Struct({
    mode: McpModeSchema,
    allow: Schema.Array(Schema.NonEmptyString),
  }),
  downgraded: Schema.Boolean,
  marks: Schema.Array(Schema.Literal("partial-filesystem", "network-unenforced", "mcp-unenforced")),
  providerSkippedForSecurity: Schema.Array(
    Schema.Struct({
      provider: ProviderIdSchema,
      reason: Schema.NonEmptyString,
    }),
  ),
});

export type SecurityPosture = Schema.Schema.Type<typeof SecurityPostureSchema>;

export const decodeSecurityPosture = Schema.decodeUnknownEither(SecurityPostureSchema);
export const encodeSecurityPosture = Schema.encodeSync(SecurityPostureSchema);
