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
  version: Schema.Literal(2),
  ...PostureBaseFields,
  // Null until a close of the phase's stop sets it.
  stop: Schema.NullOr(StopPostureSchema),
});

export type SecurityPosture = Schema.Schema.Type<typeof SecurityPostureSchema>;

/** The file as 0.25.0 wrote it, before a stop could add to it. */
export const SecurityPostureV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  ...PostureBaseFields,
});

const STRICT = { onExcessProperty: "error" } as const;

/** Version 2 only, strictly. Readers of a file on disk use `readSecurityPosture`. */
export const decodeSecurityPosture = Schema.decodeUnknownEither(SecurityPostureSchema, STRICT);
const decodeSecurityPostureV1 = Schema.decodeUnknownEither(SecurityPostureV1Schema);
export const encodeSecurityPosture = Schema.encodeSync(SecurityPostureSchema);

/**
 * The one reader of `security.json`: version 2 strictly, or version 1 lifted
 * with `stop: null`.
 */
export function readSecurityPosture(
  input: unknown,
): Either.Either<SecurityPosture, ParseResult.ParseError> {
  const isV1 =
    typeof input === "object" && input !== null && "version" in input && input.version === 1;
  if (!isV1) return decodeSecurityPosture(input);
  return Either.map(decodeSecurityPostureV1(input), (v1) => {
    const { version: _version, ...rest } = v1;
    return { version: 2 as const, ...rest, stop: null };
  });
}
