import { Either, Schema } from "effect";
import type { ParseResult } from "effect";
import { ProviderIdSchema } from "./modelRouting.js";
import { NetworkProfileSchema, McpModeSchema } from "./securityConfig.js";

const PostureBaseFields = {
  mode: Schema.Literal("secure", "unsafe", "isolated"),
  provider: ProviderIdSchema,
  sandboxEnabled: Schema.Boolean,
  filesystem: Schema.Struct({
    allowRead: Schema.Array(Schema.NonEmptyString),
    allowWrite: Schema.Array(Schema.NonEmptyString),
  }),
  network: Schema.Struct({
    profile: NetworkProfileSchema,
  }),
  mcp: Schema.Struct({
    mode: McpModeSchema,
    allow: Schema.Array(Schema.NonEmptyString),
  }),
  downgraded: Schema.Boolean,
  marks: Schema.Array(Schema.Literal("partial-filesystem", "mcp-unenforced", "command-precision")),
  agentCommands: Schema.Array(
    Schema.Struct({
      command: Schema.NonEmptyString,
      source: Schema.Literal("config", "gate", "brief"),
      explicit: Schema.Boolean,
      requiredByPlan: Schema.Boolean,
      enforcement: Schema.Literal("exact", "prefix", "executable", "none"),
      degraded: Schema.Boolean,
    }),
  ),
  // Repo-relative `.claude/skills/**` files the phase may edit (--allow-skill-edits).
  skillEditGrants: Schema.Array(Schema.NonEmptyString),
};

const ProviderSkippedForSecurityField = {
  providerSkippedForSecurity: Schema.Array(
    Schema.Struct({
      provider: ProviderIdSchema,
      reason: Schema.NonEmptyString,
    }),
  ),
};

/** What a closed stop adds: the person's work ran outside enforcement, and each turn phax ran. */
export const StopPostureSchema = Schema.Struct({
  cause: Schema.Literal("declared", "held"),
  personWork: Schema.Literal("outside-phax-enforcement"),
  turns: Schema.Array(
    Schema.Struct({
      turn: Schema.NonEmptyString,
      kind: Schema.Literal("first-turn", "closing-turn"),
      narrowing: Schema.Literal("read-only-tools", "read-only-sandbox", "none"),
      // A first or closing turn runs with no agent commands.
      agentCommands: Schema.Tuple(),
    }),
  ),
});

export const SecurityPostureSchema = Schema.Struct({
  version: Schema.Literal(3),
  ...PostureBaseFields,
  // Null when phax.json declares no protectedPaths; else the globs (the loaded
  // phax.json last) and how far the provider enforces them.
  protectedPaths: Schema.NullOr(
    Schema.Struct({
      globs: Schema.NonEmptyArray(Schema.NonEmptyString),
      enforcement: Schema.Literal("enforced", "partial", "commit-check-only"),
    }),
  ),
  ...ProviderSkippedForSecurityField,
  // Null until a close of the phase's stop sets it.
  stop: Schema.NullOr(StopPostureSchema),
});

export type SecurityPosture = Schema.Schema.Type<typeof SecurityPostureSchema>;

/** The file as 0.25.0 wrote it, before a stop could add to it. */
export const SecurityPostureV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  ...PostureBaseFields,
  ...ProviderSkippedForSecurityField,
});

/** The file as 0.26.0 through 0.30.x wrote it, before protected paths. */
export const SecurityPostureV2Schema = Schema.Struct({
  version: Schema.Literal(2),
  ...PostureBaseFields,
  ...ProviderSkippedForSecurityField,
  stop: Schema.NullOr(StopPostureSchema),
});

const STRICT = { onExcessProperty: "error" } as const;

/** Version 3 only, strictly. Readers of a file on disk use `readSecurityPosture`. */
export const decodeSecurityPosture = Schema.decodeUnknownEither(SecurityPostureSchema, STRICT);
const decodeSecurityPostureV1 = Schema.decodeUnknownEither(SecurityPostureV1Schema);
const decodeSecurityPostureV2 = Schema.decodeUnknownEither(SecurityPostureV2Schema, STRICT);
export const encodeSecurityPosture = Schema.encodeSync(SecurityPostureSchema);

/**
 * The one reader of `security.json`: version 3 strictly, version 2 lifted with
 * `protectedPaths: null`, or version 1 lifted with `protectedPaths: null` and
 * `stop: null`.
 */
export function readSecurityPosture(
  input: unknown,
): Either.Either<SecurityPosture, ParseResult.ParseError> {
  const version =
    typeof input === "object" && input !== null && "version" in input ? input.version : undefined;
  if (version === 1) {
    return Either.map(decodeSecurityPostureV1(input), (v1) => {
      const { version: _version, providerSkippedForSecurity, ...rest } = v1;
      return {
        version: 3 as const,
        ...rest,
        protectedPaths: null,
        providerSkippedForSecurity,
        stop: null,
      };
    });
  }
  if (version === 2) {
    return Either.map(decodeSecurityPostureV2(input), (v2) => {
      const { version: _version, providerSkippedForSecurity, stop, ...rest } = v2;
      return {
        version: 3 as const,
        ...rest,
        protectedPaths: null,
        providerSkippedForSecurity,
        stop,
      };
    });
  }
  return decodeSecurityPosture(input);
}
