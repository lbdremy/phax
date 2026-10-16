import type { SecurityPolicy } from "../security/types.js";

// The Claude Code permission flags a session runs under, shared by the
// headless argv (src/infra/providers/claudeCode.ts) and the interactive decide
// argv (`buildDecideInvocation`), so both carry the same policy. Pure: infra
// resolves the skill-edit grant settings and refuses a secure policy with no
// writable path before calling here.
//
// Centralized secure-mode Claude flag set. Runbook 04b will validate which of
// these the installed `claude` CLI actually enforces; corrections feed back
// here. Today's surface:
//   --permission-mode acceptEdits  (drops bypassPermissions; PHAX no longer
//                              hands the agent blanket host access. acceptEdits
//                              — NOT default — is required for headless runs:
//                              under `default` the --print session has no
//                              approver, so even in-worktree Write/Edit auto-
//                              deny and the agent cannot edit its own code.
//                              acceptEdits auto-approves edits *within* the
//                              working dirs (cwd + --add-dir) while still
//                              denying reads/writes outside them. Verified live
//                              in runbook 04b against claude 2.1.162.)
//   --add-dir <path>           (one per writable path outside cwd; cwd is
//                              implicit, so worktree pass-through happens via
//                              the spawn cwd)
//   --allowedTools Bash(...)   (one prefix rule per frozen agentCommand; the
//                              set is config ∪ gate commands, computed before
//                              the agent spawns and recorded in security.json.
//                              Under acceptEdits the headless --print session
//                              has no approver, so any Bash not matched here
//                              auto-denies. When the frozen set is empty we
//                              fall back to --disallowed-tools Bash.)
//   --disallowed-tools Bash    (full shell deny — only when there are no gate
//                              commands to allowlist)
//   --strict-mcp-config        (no MCP servers loaded unless explicitly given
//                              via --mcp-config; satisfies mcp.mode "disabled"
//                              and constrains "allowlist")
//   --mcp-config <path>...     (one per file when mcp.mode === "allowlist")
//   --settings <json>          (only with skill edit grants: an inline
//                              PermissionRequest hook allowing exactly the
//                              granted .claude/skills files; see
//                              claudeSkillEditSettings.ts)
//
// Network: there is no native --allowed-domains flag and no domain-allowlist
// concept in the policy (04b confirmed no provider enforces one). The Claude CLI
// reaches api.anthropic.com intrinsically; the agent's own egress tools
// (WebFetch/WebSearch) require approval and Bash is disallowed, so secure runs
// have no unsanctioned network path. Only network.profile is carried.

/**
 * Translate the frozen agentCommands set into Claude `--allowedTools` Bash rules.
 *
 * Each command is allowed by its exact token prefix using Claude's
 * `Bash(<prefix>:*)` wildcard, which matches the command itself plus any
 * trailing arguments. The prefix is the full normalized command — we do NOT
 * widen it to a script "family": a `pnpm format:check` entry allows
 * `pnpm format:check`, not `pnpm format`. This keeps the grant minimal;
 * commands from both config and gates are handled identically here.
 * Rules are de-duplicated and order-stable.
 */
export function gateCommandAllowRules(commands: readonly string[]): string[] {
  const rules = new Set<string>();
  for (const raw of commands) {
    const prefix = raw.trim().split(/\s+/).filter(Boolean).join(" ");
    if (prefix.length === 0) continue;
    rules.add(`Bash(${prefix}:*)`);
  }
  return [...rules];
}

export interface ClaudePermissionInput {
  readonly security: SecurityPolicy;
  readonly cwd: string;
  /** The frozen agent commands allowlisted as Bash; empty denies Bash. */
  readonly agentCommands: readonly string[];
  /** The inline `--settings` object granting skill edits, or undefined for none. */
  readonly grantSettings: object | undefined;
}

function secureClaudeFlags(input: ClaudePermissionInput): string[] {
  const { security, cwd } = input;
  const addDirs = security.filesystem.allowWrite
    .filter((p) => p !== cwd)
    .flatMap((p) => ["--add-dir", p]);

  const mcpFlags: string[] = [];
  if (security.mcp.mode !== "provider-default") {
    mcpFlags.push("--strict-mcp-config");
  }
  if (security.mcp.mode === "allowlist") {
    for (const path of security.mcp.allow) {
      mcpFlags.push("--mcp-config", path);
    }
  }

  // Allowlist the frozen agentCommands set (config ∪ gates) as sandboxed Bash
  // so the agent can run the commands it needs; everything else stays denied.
  // With no commands, fall back to a full Bash deny (disallowed-tools takes
  // precedence over allowedTools, so the two are mutually exclusive).
  const allowRules = gateCommandAllowRules(input.agentCommands);
  const shellFlags =
    allowRules.length > 0
      ? ["--allowedTools", allowRules.join(",")]
      : ["--disallowed-tools", "Bash"];

  // Declared skill files get through Claude's protected-path check via an
  // inline PermissionRequest hook; with no grants the argv is unchanged.
  const settingsFlags =
    input.grantSettings === undefined ? [] : ["--settings", JSON.stringify(input.grantSettings)];

  return [
    "--permission-mode",
    "acceptEdits",
    ...addDirs,
    ...shellFlags,
    ...mcpFlags,
    ...settingsFlags,
  ];
}

/**
 * The permission flags of a Claude Code session under `security`. Unsafe:
 * `--permission-mode bypassPermissions` — phax owns the directory it spawns
 * claude in, so prompting for Write/Edit approval would deadlock a headless
 * session. Secure (and isolated, which the CLI gates before reaching here):
 * the secure flag set above.
 */
export function claudePermissionFlags(input: ClaudePermissionInput): string[] {
  if (input.security.mode === "unsafe") return ["--permission-mode", "bypassPermissions"];
  return secureClaudeFlags(input);
}
