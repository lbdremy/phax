import { PHAX_APPROVED_PATHS_ENV } from "../../schemas/claudeHookPayload.js";

export { PHAX_APPROVED_PATHS_ENV };

/**
 * Claude Code settings object shape for a PreToolUse hook entry.
 * This is a pure module — no I/O.
 */
export interface ClaudeHookSettings {
  readonly env: Record<string, string>;
  readonly hooks: {
    readonly PreToolUse: ReadonlyArray<{
      readonly matcher: string;
      readonly hooks: ReadonlyArray<{
        readonly type: "command";
        readonly command: string;
      }>;
    }>;
  };
}

/**
 * Pure builder: given the absolute paths the operator has approved and the
 * command phax should invoke for the hook, returns the Claude settings object
 * that wires a PreToolUse hook scoped to Edit|Write|MultiEdit.
 *
 * Approved paths are passed to the hook process via the PHAX_APPROVED_PATHS
 * env var (JSON-encoded) set in the settings `env` block — no arg-quoting
 * pitfalls, no shell escaping required.
 */
export function buildProtectedPathHookSettings(
  approvedAbsolutePaths: readonly string[],
  hookCommand: string,
): ClaudeHookSettings {
  return {
    env: {
      [PHAX_APPROVED_PATHS_ENV]: JSON.stringify(approvedAbsolutePaths),
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [{ type: "command", command: hookCommand }],
        },
      ],
    },
  };
}
