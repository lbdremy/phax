import { join } from "node:path";
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
//       One per writable root beyond the worktree (configured extras). Vibe
//       trusts an --add-dir root as a project and loads the `.vibe/` and
//       `.agents/` config under it, so the adapter refuses a root that already
//       holds one, and VIBE_TOOLS denies writing one in any root.
//   VIBE_OUTSIDE_WORKDIR=deny
//       A call that reaches outside the working directories is refused rather
//       than asked about (a headless turn has nobody to ask).
//   VIBE_BYPASS_TOOL_PERMISSIONS=false
//       Overrides a user config that turned permission checks off.
//   VIBE_TOOLS=<json>
//       bash asks (and so is refused headless) for anything not on its
//       allowlist, which is exactly the phase's agent commands; the file tools
//       get an empty allowlist so a user's own entries cannot widen them, and
//       every tool phax names denies reaching outside the working directories
//       whatever a user's per-tool `outside_workdir` says. write_file and edit
//       deny `<root>/.vibe/**` and `<root>/.agents/**` in every root.
//       web_fetch/web_search are left alone, as Claude Code's secure flags do.
//   VIBE_ENABLE_MCP=false, VIBE_ENABLE_CONNECTORS=false
//       When the policy disables MCP or allowlists servers: no MCP server or
//       connector tool loads (Vibe cannot load only an allowlist).
//
// A read-only session (whatever the policy mode) enables only read_file and
// grep, plus bash when it was granted commands, in the worktree alone (no
// --add-dir), and carries the secure variables, VIBE_TOOLS included. A sealed
// completion disables every tool (`--disabled-tools '*'`): the model still
// sees tool names, its calls are refused.
//
// Network scoping is not expressed here: the resolved policy is recorded in
// security.json only.
//
// The environment layer sits below an agent profile in Vibe's config, so a
// profile can undo any of it. `vibeConfigMismatch` reads the config a turn
// actually ran with (its export's `config`) back against what phax set.

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
  return {
    agent: [
      "--agent",
      "accept-edits",
      ...readOnlyTools(input).flatMap((tool) => ["--enabled-tools", tool]),
    ],
    scope: ["--workdir", input.cwd],
    env: {
      ...SECURE_ENV,
      ...mcpEnv(input.security),
      VIBE_TOOLS: JSON.stringify(vibeTools(input.agentCommands, [input.cwd])),
    },
  };
}

/** The tools a read-only session enables: read_file and grep, plus bash when it has agent commands. */
function readOnlyTools(input: VibeFlagsInput): readonly string[] {
  return input.agentCommands.length > 0 ? ["read_file", "grep", "bash"] : ["read_file", "grep"];
}

/** The flags of a sealed completion: every tool disabled, the completion's cwd, nothing writable added. */
export function buildSealedVibeFlags(cwd: string): VibeFlags {
  return {
    agent: ["--agent", "accept-edits", "--disabled-tools", "*"],
    scope: ["--workdir", cwd],
    env: SECURE_ENV,
  };
}

/** The paths under a root whose Vibe config a trusted root would load. */
export const VIBE_PROJECT_CONFIG_DIRS = [".vibe", ".agents"] as const;

/**
 * The tool settings phax gives a secure or read-only session: bash allowlists
 * exactly `agentCommands`, the file tools allowlist nothing, every named tool
 * but grep denies reaching outside the working directories, and write_file and
 * edit deny the Vibe config directories of every root in `roots`.
 */
function vibeTools(
  agentCommands: readonly string[],
  roots: readonly string[],
): Record<string, Record<string, unknown>> {
  const configGuards = roots.flatMap((root) =>
    VIBE_PROJECT_CONFIG_DIRS.map((dir) => `${root}/${dir}/**`),
  );
  return {
    bash: { permission: "ask", allowlist: [...agentCommands], outside_workdir: "deny" },
    read_file: { allowlist: [], outside_workdir: "deny" },
    write_file: { allowlist: [], denylist: configGuards, outside_workdir: "deny" },
    edit: { allowlist: [], denylist: configGuards, outside_workdir: "deny" },
    grep: { allowlist: [] },
  };
}

/**
 * The variables that turn MCP servers and connectors off when the policy
 * disables MCP, or allowlists servers: Vibe cannot load only those, so it
 * loads none.
 */
function mcpEnv(security: SecurityPolicy): Readonly<Record<string, string>> {
  return security.mcp.mode === "disabled" || security.mcp.mode === "allowlist"
    ? { VIBE_ENABLE_MCP: "false", VIBE_ENABLE_CONNECTORS: "false" }
    : {};
}

/** The writable roots a secure session opens with `--add-dir`: every one but the cwd. */
export function vibeExtraRoots(security: SecurityPolicy, cwd: string): readonly string[] {
  return security.filesystem.allowWrite.filter((path) => path !== cwd);
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
  const extraRoots = vibeExtraRoots(security, cwd);
  return {
    agent: ["--agent", "accept-edits"],
    scope: ["--workdir", cwd, ...extraRoots.flatMap((path) => ["--add-dir", path])],
    env: {
      ...SECURE_ENV,
      ...mcpEnv(security),
      VIBE_TOOLS: JSON.stringify(vibeTools(input.agentCommands, [cwd, ...extraRoots])),
    },
  };
}

/** Whether phax confines this session: a secure (or isolated) one, or any read-only one. */
export function isConfinedVibeSession(input: VibeFlagsInput): boolean {
  return input.readOnly === true || input.security.mode !== "unsafe";
}

/**
 * The user agent profile that would replace Vibe's built-in `accept-edits`,
 * which every confined session runs under: `$VIBE_HOME/agents/accept-edits.toml`,
 * `VIBE_HOME` defaulting to `<home>/.vibe`. Null when neither is known.
 */
export function vibeAcceptEditsOverridePath(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string | null {
  const vibeHome = env["VIBE_HOME"];
  if (vibeHome !== undefined && vibeHome !== "")
    return join(vibeHome, "agents", "accept-edits.toml");
  return home === "" ? null : join(home, ".vibe", "agents", "accept-edits.toml");
}

const shown = (value: unknown): string => (value === undefined ? "absent" : JSON.stringify(value));

/**
 * What differs between the config a confined Vibe turn ran with (its export's
 * `config`) and the config phax set for it, as `<field> is <actual>, phax set
 * <expected>`; undefined when every value phax set holds. A field phax does
 * not set is not compared. An unconfined session is never compared.
 */
export function vibeConfigMismatch(input: VibeFlagsInput, config: unknown): string | undefined {
  if (!isConfinedVibeSession(input)) return undefined;
  if (typeof config !== "object" || config === null) {
    return `config is ${shown(config)}, phax needs the config the turn ran with`;
  }
  const actual = config as Record<string, unknown>;
  const flags = buildVibeFlags(input);
  const expected: [string, unknown, unknown][] = [
    ["bypass_tool_permissions", actual["bypass_tool_permissions"], false],
    ["outside_workdir", actual["outside_workdir"], "deny"],
  ];
  if (flags.env["VIBE_ENABLE_MCP"] !== undefined) {
    expected.push(["enable_mcp", actual["enable_mcp"], false]);
    expected.push(["enable_connectors", actual["enable_connectors"], false]);
  }
  const tools = JSON.parse(flags.env["VIBE_TOOLS"] ?? "{}") as Record<
    string,
    Record<string, unknown>
  >;
  const actualTools = (actual["tools"] ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  for (const [tool, settings] of Object.entries(tools)) {
    for (const [key, value] of Object.entries(settings)) {
      expected.push([`tools.${tool}.${key}`, actualTools[tool]?.[key], value]);
    }
  }
  if (input.readOnly === true) {
    const enabled = actual["enabled_tools"];
    const sorted = Array.isArray(enabled)
      ? [...(enabled as unknown[])].map(String).toSorted()
      : enabled;
    expected.push(["enabled_tools", sorted, [...readOnlyTools(input)].toSorted()]);
  }
  for (const [field, got, want] of expected) {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      return `${field} is ${shown(got)}, phax set ${JSON.stringify(want)}`;
    }
  }
  return undefined;
}
