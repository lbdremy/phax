import { Either, Schema } from "effect";

/**
 * Env var name that carries the JSON-encoded array of approved absolute paths
 * from the Claude settings file into the hook command process. Defined here
 * (schemas layer) so both cli/ and infra/ can import it without violating
 * the cli→infra boundary guard.
 */
export const PHAX_APPROVED_PATHS_ENV = "PHAX_APPROVED_PATHS";

/**
 * Subset of the Claude Code PreToolUse stdin payload that phax needs.
 * Extra fields from the actual payload are tolerated and ignored.
 */
export const ClaudeHookPayloadSchema = Schema.Struct({
  tool_name: Schema.String,
  tool_input: Schema.Struct({
    file_path: Schema.optional(Schema.String),
  }),
});

export type ClaudeHookPayload = Schema.Schema.Type<typeof ClaudeHookPayloadSchema>;

export const decodeClaudeHookPayload = Schema.decodeUnknownEither(ClaudeHookPayloadSchema);

export function parseClaudeHookPayload(raw: string): ClaudeHookPayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = decodeClaudeHookPayload(parsed);
  return Either.isRight(result) ? result.right : undefined;
}
