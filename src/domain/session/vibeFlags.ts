import { SecurityEnforcementError } from "../errors.js";
import type { SecurityPolicy } from "../security/types.js";

// The Vibe 3 confinement a session runs under, built per invocation: phax
// never writes a Vibe config file. Pure: the adapter
// (src/infra/providers/mistralVibe.ts) splices the argv flags into its vector
// and merges the environment additions over the process environment.
//
// Vibe enforces its tool permissions only when auto-approve is off, so a
// secure session runs under:
//   --agent accept-edits
//       Edits inside the working directories are approved; anything else falls
//       to the per-tool permission rules below. Never auto-approve, never
//       --trust, whatever the provider entry's `defaultAgent` says.
//   --workdir <cwd>
//       The worktree is the working directory.
//   --add-dir <path>
//       One per writable root beyond the worktree (~/.phax, configured extras).
//   VIBE_OUTSIDE_WORKDIR=deny
//       A call that reaches outside the working directories is refused rather
//       than asked about (a headless turn has nobody to ask).
//   VIBE_BYPASS_TOOL_PERMISSIONS=false
//       Overrides a user config that turned permission checks off.
//   VIBE_TOOLS=<json>
//       bash asks (and so is refused headless) for anything not on its
//       allowlist, which is exactly the phase's agent commands; the file tools
//       get an empty allowlist so a user's own entries cannot widen them.
//       web_fetch/web_search are left alone, as Claude Code's secure flags do.
//
// A read-only session (whatever the policy mode) enables only read_file and
// grep, plus bash with the secure VIBE_TOOLS when it was granted commands, and
// carries the two secure variables. A sealed completion disables every tool
// (`--disabled-tools '*'`): the model still sees tool names, its calls are
// refused.
//
// Network and MCP scoping are not expressed here: the resolved policy is
// recorded in security.json only.

export interface VibeFlagsInput {
  readonly security: SecurityPolicy;
  readonly cwd: string;
  /** The frozen agent commands (config ∪ gates), allowlisted for bash in order. */
  readonly agentCommands: readonly string[];
  /** The agent an unsafe session runs; secure sessions ignore it. */
  readonly unsafeAgent?: string | undefined;
  /** A read-only session enables only reading tools (plus bash when it has agent commands). */
  readonly readOnly?: boolean | undefined;
}

export interface VibeFlags {
  /** `--agent <name>`, placed right after the prompt. */
  readonly agent: readonly string[];
  /** `--trust`/`--workdir`/`--add-dir`, placed after the output flags. */
  readonly scope: readonly string[];
  /** Variables merged over the process environment. */
  readonly env: Readonly<Record<string, string>>;
}

const SECURE_ENV = {
  VIBE_OUTSIDE_WORKDIR: "deny",
  VIBE_BYPASS_TOOL_PERMISSIONS: "false",
} as const;

function readOnlyFlags(input: VibeFlagsInput): VibeFlags {
  const addDirs =
    input.security.mode === "unsafe"
      ? []
      : input.security.filesystem.allowWrite
          .filter((path) => path !== input.cwd)
          .flatMap((path) => ["--add-dir", path]);
  const withCommands = input.agentCommands.length > 0;
  return {
    agent: [
      "--agent",
      "accept-edits",
      "--enabled-tools",
      "read_file",
      "--enabled-tools",
      "grep",
      ...(withCommands ? ["--enabled-tools", "bash"] : []),
    ],
    scope: ["--workdir", input.cwd, ...addDirs],
    env: withCommands
      ? { ...SECURE_ENV, VIBE_TOOLS: secureVibeTools(input.agentCommands) }
      : SECURE_ENV,
  };
}

/** The flags of a sealed completion: every tool disabled, the completion's cwd, nothing writable added. */
export function buildSealedVibeFlags(cwd: string): VibeFlags {
  return {
    agent: ["--agent", "accept-edits", "--disabled-tools", "*"],
    scope: ["--workdir", cwd],
    env: SECURE_ENV,
  };
}

/** The `VIBE_TOOLS` value of a secure session allowlisting `agentCommands` for bash. */
function secureVibeTools(agentCommands: readonly string[]): string {
  return JSON.stringify({
    bash: { permission: "ask", allowlist: [...agentCommands] },
    read_file: { allowlist: [] },
    write_file: { allowlist: [] },
    edit: { allowlist: [] },
    grep: { allowlist: [] },
  });
}

/**
 * The argv flags and environment additions of one Vibe invocation. Throws
 * `SecurityEnforcementError` for a secure policy with no writable path.
 */
export function buildVibeFlags(input: VibeFlagsInput): VibeFlags {
  const { security, cwd } = input;
  if (input.readOnly === true) return readOnlyFlags(input);
  if (security.mode === "unsafe") {
    return {
      agent: ["--agent", input.unsafeAgent ?? "auto-approve"],
      scope: ["--trust", "--workdir", cwd],
      env: {},
    };
  }
  // secure / isolated (CLI gates isolated before reaching here; treat as
  // secure for type totality).
  if (security.filesystem.allowWrite.length === 0) {
    throw new SecurityEnforcementError({
      message:
        "Mistral Vibe secure mode requires at least one writable path in the security policy; refusing to run unconfined.",
      provider: "mistral-vibe",
      mode: security.mode,
    });
  }
  const addDirs = security.filesystem.allowWrite
    .filter((path) => path !== cwd)
    .flatMap((path) => ["--add-dir", path]);
  return {
    agent: ["--agent", "accept-edits"],
    scope: ["--workdir", cwd, ...addDirs],
    env: {
      VIBE_OUTSIDE_WORKDIR: "deny",
      VIBE_BYPASS_TOOL_PERMISSIONS: "false",
      VIBE_TOOLS: secureVibeTools(input.agentCommands),
    },
  };
}
