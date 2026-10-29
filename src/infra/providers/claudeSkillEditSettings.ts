const EDIT_TOOLS = ["Edit", "Write", "MultiEdit"] as const;

const ALLOW_DECISION = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
});

/**
 * Builds the inline `--settings` object that lets a headless secure-mode Claude
 * session edit exactly the granted `.claude/skills/**` files (repo-relative).
 *
 * Probed on Claude Code 2.1.280: `.claude/` is a protected path, checked before
 * `permissions.allow` rules, and a `PreToolUse` hook returning allow does NOT
 * bypass it — only a `PermissionRequest` allow does. The handler `if` rule
 * matches by tool name (`Edit(...)` does not match a `Write` call), so each
 * file gets one handler per edit tool. `//abs/path` is the absolute-path form.
 */
export function buildSkillEditGrantSettings(
  worktreeRoot: string,
  grants: readonly string[],
): object | undefined {
  if (grants.length === 0) return undefined;
  const root = worktreeRoot.replace(/\/+$/, "");
  const handlers = grants.flatMap((grant) =>
    EDIT_TOOLS.map((tool) => ({
      type: "command",
      if: `${tool}(/${root}/${grant})`,
      command: `echo '${ALLOW_DECISION}'`,
    })),
  );
  return {
    hooks: {
      PermissionRequest: [{ matcher: EDIT_TOOLS.join("|"), hooks: handlers }],
    },
  };
}

/**
 * The one inline `--settings` object of a secure Claude session: the skill-edit
 * hooks (when there are grants) merged with `permissions.deny` holding the
 * protected-path rules (when there are any). Undefined when both are empty, so
 * a session with neither passes no `--settings`.
 */
export function buildClaudeSessionSettings(
  worktreeRoot: string,
  grants: readonly string[],
  denyRules: readonly string[],
): object | undefined {
  const hooks = buildSkillEditGrantSettings(worktreeRoot, grants);
  if (denyRules.length === 0) return hooks;
  return { ...hooks, permissions: { deny: [...denyRules] } };
}
