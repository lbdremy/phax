/**
 * The switches that make a headless Claude Code session project-only.
 *
 * `--setting-sources project` drops the operator's user settings and, with
 * them, user skills, plugins, hooks and instructions (`~/.claude/CLAUDE.md`,
 * rules). `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` drops auto-memory.
 *
 * Still loaded: the repository's harness (`.claude/`, `CLAUDE.md`), bundled
 * skills, builtin plugins, managed settings, and MCP per the security policy.
 */
export const CLAUDE_PROJECT_ONLY_FLAGS = ["--setting-sources", "project"] as const;

/**
 * The environment of a project-only session: every defined inherited variable
 * unchanged, plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` over whatever it was.
 * Returns a new object; the input is never mutated.
 */
export function projectOnlyEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (value !== undefined) env[name] = value;
  }
  env["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] = "1";
  return env;
}
