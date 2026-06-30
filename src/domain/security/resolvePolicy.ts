import type { ResolvedSecurityConfig } from "../../schemas/securityConfig.js";
import type { SecurityMode, SecurityPolicy } from "./types.js";

export interface ResolvePolicyInput {
  readonly mode: SecurityMode;
  readonly worktreePath: string;
  readonly config: ResolvedSecurityConfig;
}

function dedupe(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)];
}

export function resolveSecurityPolicy(input: ResolvePolicyInput): SecurityPolicy {
  const { mode, worktreePath, config } = input;

  if (mode === "unsafe") {
    return {
      mode: "unsafe",
      // allowWriteProtected is a secure-mode concept; unsafe mode already
      // drops the jail entirely, so the hook is never generated.
      filesystem: { allowRead: [], allowWrite: [], allowWriteProtected: [] },
      network: { profile: config.network.profile },
      mcp: { mode: config.mcp.mode, allow: [] },
      agentCommands: config.agentCommands,
      failClosed: false,
    };
  }

  // secure (and isolated — treated like secure for type totality; the CLI
  // gates isolated before a run starts, so this branch is only reached in tests
  // or if the caller bypasses the CLI gate)
  //
  // The worktree (the agent's cwd) is the only path granted by default. The
  // phax state root (~/.phax) is deliberately NOT included: the worktree already
  // lives under ~/.phax/worktrees/<run>/<phase>, run artifacts in ~/.phax/runs
  // are written by the unsandboxed parent process (not the agent), and the
  // phase handoff is written inside the worktree's .phax-context/. Granting the
  // whole state root would expose every other run and project worktree under
  // ~/.phax. Projects that genuinely need state-root access (e.g. phax debugging
  // itself) opt in via `security.filesystem.allowWrite` in phax.json.
  const allowWrite = dedupe([worktreePath, ...config.filesystem.allowWrite]);
  const allowRead = dedupe([...allowWrite, ...config.filesystem.allowRead]);

  // Network is governed only by `network.profile`. No domain allowlist exists:
  // each provider CLI reaches its own API intrinsically (the parent process
  // talks to the model outside any sandbox), and no provider enforces a domain
  // allowlist (confirmed live in runbook 04b). `provider-only` drives codex's
  // network_access=false; broader profiles permit subprocess network.
  return {
    mode,
    filesystem: {
      allowRead,
      allowWrite,
      allowWriteProtected: config.filesystem.allowWriteProtected,
    },
    network: { profile: config.network.profile },
    mcp: { mode: config.mcp.mode, allow: config.mcp.allow },
    agentCommands: config.agentCommands,
    failClosed: true,
  };
}
