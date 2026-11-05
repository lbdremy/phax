/**
 * Claude Code's not-authenticated wordings, matched case-insensitively as
 * substrings of a verdict (a result event's text, stderr). Only the Claude
 * reader uses them: the shared signature table, Codex and Vibe do not.
 */
export const CLAUDE_NOT_AUTHENTICATED_SIGNATURES: readonly string[] = [
  "Invalid API key",
  "Please run /login",
  "OAuth token has expired",
  "OAuth token revoked",
  "Not logged in",
  "authentication_error",
];

const lowerCaseSignatures = CLAUDE_NOT_AUTHENTICATED_SIGNATURES.map((signature) =>
  signature.toLowerCase(),
);

/** Whether a Claude verdict text says the session is not authenticated. */
export function isClaudeNotAuthenticatedText(text: string): boolean {
  const folded = text.replace(/[‘’]/g, "'").toLowerCase();
  return lowerCaseSignatures.some((signature) => folded.includes(signature));
}

/**
 * The two lines that follow a `not-authenticated` failure line: what happened
 * (headless sessions skip user settings) and the two remedies. Worded once.
 */
export const NOT_AUTHENTICATED_REMEDY_LINES: readonly [string, string] = [
  "Claude Code is not authenticated. phax's headless sessions do not load your Claude Code user settings (~/.claude/settings.json), so an apiKeyHelper or env set there is not used.",
  "Log in with `claude /login`, or set ANTHROPIC_API_KEY where you run phax.",
];
