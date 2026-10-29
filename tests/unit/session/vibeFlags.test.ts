import { describe, expect, it } from "vitest";
import { SecurityEnforcementError } from "../../../src/domain/errors.js";
import { protectedList } from "../../../src/domain/security/protectedPaths.js";
import type { SecurityPolicy } from "../../../src/domain/security/types.js";
import {
  buildSealedVibeFlags,
  buildVibeFlags,
  vibeAcceptEditsOverridePath,
  vibeConfigMismatch,
  type VibeFlagsInput,
} from "../../../src/domain/session/vibeFlags.js";

const securePolicy: SecurityPolicy = {
  mode: "secure",
  filesystem: {
    allowRead: ["/work/tree", "/home/me/.phax"],
    allowWrite: ["/work/tree", "/home/me/.phax", "/data/extra"],
  },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
  failClosed: true,
};

const unsafePolicy: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open" },
  mcp: { mode: "provider-default", allow: [] },
  agentCommands: [],
  failClosed: false,
};

const AGENT_COMMANDS = ["pnpm test:integration", "pnpm exec tsx scripts/schemas-check.ts --write"];

const secureFlags = (agentCommands: readonly string[] = AGENT_COMMANDS) =>
  buildVibeFlags({
    security: securePolicy,
    cwd: "/work/tree",
    agentCommands,
    unsafeAgent: "auto-approve",
  });

describe("buildVibeFlags — secure", () => {
  it("runs accept-edits in the worktree with one --add-dir per extra writable root", () => {
    const flags = secureFlags();
    expect(flags.agent).toEqual(["--agent", "accept-edits"]);
    expect(flags.scope).toEqual([
      "--workdir",
      "/work/tree",
      "--add-dir",
      "/home/me/.phax",
      "--add-dir",
      "/data/extra",
    ]);
  });

  it("never carries auto-approve, --auto-approve or --trust, even when asked for an unsafe agent", () => {
    const argv = [...secureFlags().agent, ...secureFlags().scope];
    expect(argv).not.toContain("auto-approve");
    expect(argv).not.toContain("--auto-approve");
    expect(argv).not.toContain("--trust");
  });

  it("sets the secure variables, bash allowlisted to exactly the agent commands in order", () => {
    const { env } = secureFlags();
    expect(Object.keys(env).toSorted()).toEqual([
      "VIBE_BYPASS_TOOL_PERMISSIONS",
      "VIBE_ENABLE_CONNECTORS",
      "VIBE_ENABLE_MCP",
      "VIBE_OUTSIDE_WORKDIR",
      "VIBE_TOOLS",
    ]);
    expect(env["VIBE_OUTSIDE_WORKDIR"]).toBe("deny");
    expect(env["VIBE_BYPASS_TOOL_PERMISSIONS"]).toBe("false");
    const guards = ["/work/tree", "/home/me/.phax", "/data/extra"].flatMap((root) => [
      `${root}/.vibe/**`,
      `${root}/.agents/**`,
    ]);
    expect(JSON.parse(env["VIBE_TOOLS"] ?? "null")).toEqual({
      bash: { permission: "ask", allowlist: AGENT_COMMANDS, outside_workdir: "deny" },
      read_file: { allowlist: [], outside_workdir: "deny" },
      write_file: { allowlist: [], denylist: guards, outside_workdir: "deny" },
      edit: { allowlist: [], denylist: guards, outside_workdir: "deny" },
      grep: { allowlist: [] },
    });
  });

  it.each([
    ["disabled", true],
    ["allowlist", true],
    ["local-only", false],
    ["provider-default", false],
  ] as const)("turns MCP servers and connectors off under mcp.mode %s: %s", (mode, off) => {
    const flags = buildVibeFlags({
      security: { ...securePolicy, mcp: { mode, allow: [] } },
      cwd: "/work/tree",
      agentCommands: [],
    });
    expect(flags.env["VIBE_ENABLE_MCP"]).toBe(off ? "false" : undefined);
    expect(flags.env["VIBE_ENABLE_CONNECTORS"]).toBe(off ? "false" : undefined);
  });

  it("sets every key a loose user config could widen, and leaves the web tools alone", () => {
    const tools = JSON.parse(secureFlags([]).env["VIBE_TOOLS"] ?? "null") as Record<
      string,
      { allowlist: string[] }
    >;
    expect(tools["bash"]?.allowlist).toEqual([]);
    for (const tool of ["read_file", "write_file", "edit", "grep"]) {
      expect(tools[tool]?.allowlist, tool).toEqual([]);
    }
    expect(tools).not.toHaveProperty("web_fetch");
    expect(tools).not.toHaveProperty("web_search");
  });

  it("isolated follows the secure branch for type totality", () => {
    const flags = buildVibeFlags({
      security: { ...securePolicy, mode: "isolated" },
      cwd: "/work/tree",
      agentCommands: [],
    });
    expect(flags.agent).toEqual(["--agent", "accept-edits"]);
    expect(flags.env["VIBE_OUTSIDE_WORKDIR"]).toBe("deny");
  });

  it("refuses a secure policy with no writable path", () => {
    expect(() =>
      buildVibeFlags({
        security: { ...securePolicy, filesystem: { allowRead: [], allowWrite: [] } },
        cwd: "/work/tree",
        agentCommands: [],
      }),
    ).toThrow(SecurityEnforcementError);
  });
});

const readOnly = (security: SecurityPolicy, agentCommands: readonly string[]) =>
  buildVibeFlags({ security, cwd: "/work/tree", agentCommands, readOnly: true });

describe("buildVibeFlags — read-only", () => {
  it("enables only read_file and grep in the worktree alone when it has no agent commands", () => {
    const flags = readOnly(securePolicy, []);
    expect(flags.agent).toEqual([
      "--agent",
      "accept-edits",
      "--enabled-tools",
      "read_file",
      "--enabled-tools",
      "grep",
    ]);
    expect(flags.scope).toEqual(["--workdir", "/work/tree"]);
    expect(flags.env).toMatchObject({
      VIBE_OUTSIDE_WORKDIR: "deny",
      VIBE_BYPASS_TOOL_PERMISSIONS: "false",
    });
  });

  it("carries VIBE_TOOLS even with no agent commands, so a user's file-tool allowlists never apply", () => {
    const tools = JSON.parse(readOnly(securePolicy, []).env["VIBE_TOOLS"] ?? "null");
    expect(tools.bash).toEqual({ permission: "ask", allowlist: [], outside_workdir: "deny" });
    expect(tools.read_file).toEqual({ allowlist: [], outside_workdir: "deny" });
    expect(tools.grep).toEqual({ allowlist: [] });
  });

  it("adds bash, allowlisted to the agent commands, when it has some", () => {
    const flags = readOnly(securePolicy, AGENT_COMMANDS);
    expect(flags.agent.slice(-2)).toEqual(["--enabled-tools", "bash"]);
    const tools = JSON.parse(flags.env["VIBE_TOOLS"] ?? "{}");
    expect(tools.bash).toEqual({
      permission: "ask",
      allowlist: AGENT_COMMANDS,
      outside_workdir: "deny",
    });
    expect(flags.env["VIBE_OUTSIDE_WORKDIR"]).toBe("deny");
  });

  it("is narrowed whatever the policy mode, with no --trust and no --add-dir for unsafe", () => {
    const flags = readOnly(unsafePolicy, []);
    expect(flags.agent).toContain("--enabled-tools");
    expect(flags.agent).not.toContain("auto-approve");
    expect(flags.scope).toEqual(["--workdir", "/work/tree"]);
    expect(flags.env["VIBE_BYPASS_TOOL_PERMISSIONS"]).toBe("false");
    expect(flags.env).not.toHaveProperty("VIBE_ENABLE_MCP");
  });
});

/** The config Vibe resolves from `input`'s flags: what an export reads back when nothing overrode phax. */
function resolvedConfig(input: VibeFlagsInput): Record<string, unknown> {
  const flags = buildVibeFlags(input);
  const enabled = flags.agent.flatMap((arg, at) =>
    arg === "--enabled-tools" ? [flags.agent[at + 1]] : [],
  );
  return {
    active_model: "mistral-medium-3.5",
    bypass_tool_permissions: false,
    outside_workdir: "deny",
    tools: JSON.parse(flags.env["VIBE_TOOLS"] ?? "{}"),
    enabled_tools: enabled,
    enable_mcp: flags.env["VIBE_ENABLE_MCP"] === undefined,
    enable_connectors: flags.env["VIBE_ENABLE_CONNECTORS"] === undefined,
  };
}

describe("vibeConfigMismatch", () => {
  const secureInput: VibeFlagsInput = {
    security: securePolicy,
    cwd: "/work/tree",
    agentCommands: AGENT_COMMANDS,
  };
  const readOnlyInput: VibeFlagsInput = { ...secureInput, readOnly: true };

  it.each([
    ["secure", secureInput],
    ["read-only", readOnlyInput],
  ])("accepts the config a %s turn resolves from phax's flags", (_kind, input) => {
    expect(vibeConfigMismatch(input, resolvedConfig(input))).toBeUndefined();
  });

  it.each([
    ["bypass_tool_permissions", { bypass_tool_permissions: true }, "true"],
    ["outside_workdir", { outside_workdir: "ask" }, '"ask"'],
    ["enable_mcp", { enable_mcp: true }, "true"],
    ["enable_connectors", { enable_connectors: true }, "true"],
  ])("names %s when a profile changed it", (field, change, actual) => {
    const config = { ...resolvedConfig(secureInput), ...change };
    expect(vibeConfigMismatch(secureInput, config)).toMatch(`${field} is ${actual}, phax set `);
  });

  it("names the tool setting a profile widened", () => {
    const config = resolvedConfig(secureInput);
    const tools = config["tools"] as Record<string, Record<string, unknown>>;
    tools["read_file"] = { allowlist: ["/home/me/notes/**"], outside_workdir: "deny" };
    expect(vibeConfigMismatch(secureInput, config)).toBe(
      'tools.read_file.allowlist is ["/home/me/notes/**"], phax set []',
    );
  });

  it("names a read-only turn's enabled tools when they are not the ones phax enabled", () => {
    const config = { ...resolvedConfig(readOnlyInput), enabled_tools: ["read_file", "write_file"] };
    expect(vibeConfigMismatch(readOnlyInput, config)).toMatch(/^enabled_tools is /);
  });

  it.each([null, undefined, "x"])("refuses a confined turn whose config is %j", (config) => {
    expect(vibeConfigMismatch(secureInput, config)).toMatch(/^config is /);
  });

  it("never compares an unsafe session", () => {
    const unsafeInput: VibeFlagsInput = { security: unsafePolicy, cwd: "/w", agentCommands: [] };
    expect(vibeConfigMismatch(unsafeInput, { bypass_tool_permissions: true })).toBeUndefined();
  });
});

const toolsOf = (input: VibeFlagsInput) =>
  JSON.parse(buildVibeFlags(input).env["VIBE_TOOLS"] ?? "null") as Record<
    string,
    { denylist?: string[] }
  >;

describe("protected paths", () => {
  // phax.json is implied, as the loaded config always is.
  const list = protectedList(["**/steme.baseline.json", "config/*.json"], "phax.json") ?? [];
  const ROOT = "/real/work/tree";
  const ENTRIES = [
    `${ROOT}/steme.baseline.json`,
    `${ROOT}/**/steme.baseline.json`,
    `${ROOT}/phax.json`,
  ];
  const guards = ["/work/tree", "/home/me/.phax", "/data/extra"].flatMap((root) => [
    `${root}/.vibe/**`,
    `${root}/.agents/**`,
  ]);
  const protectedInput: VibeFlagsInput = {
    security: securePolicy,
    cwd: "/work/tree",
    agentCommands: AGENT_COMMANDS,
    protectedPaths: { root: ROOT, list },
  };
  it("appends the native entries to the write_file and edit denylists after the guards, under root", () => {
    const tools = toolsOf(protectedInput);
    expect(tools["write_file"]?.denylist).toEqual([...guards, ...ENTRIES]);
    expect(tools["edit"]?.denylist).toEqual([...guards, ...ENTRIES]);
    expect(tools["bash"]).not.toHaveProperty("denylist");
    const flags = buildVibeFlags(protectedInput);
    expect(flags.scope.slice(0, 2)).toEqual(["--workdir", "/work/tree"]);
  });

  it("gives no entry for a wildcard glob and none under the extra roots", () => {
    const denylist = toolsOf(protectedInput)["write_file"]?.denylist ?? [];
    expect(denylist.some((entry) => entry.includes("config/"))).toBe(false);
    expect(denylist.filter((entry) => entry.startsWith("/data/extra")).length).toBe(2);
  });

  it("leaves the denylists as they are when nothing is declared", () => {
    const { protectedPaths: _none, ...plain } = protectedInput;
    expect(toolsOf(plain)["write_file"]?.denylist).toEqual(guards);
  });

  it("adds nothing for an unsafe or a read-only session", () => {
    const unsafe = buildVibeFlags({ ...protectedInput, security: unsafePolicy });
    expect(unsafe.env).toEqual({});
    const readOnlyTools = toolsOf({ ...protectedInput, readOnly: true });
    expect(readOnlyTools["write_file"]?.denylist).toEqual([
      "/work/tree/.vibe/**",
      "/work/tree/.agents/**",
    ]);
  });

  it("accepts the export that holds the protected entries", () => {
    expect(vibeConfigMismatch(protectedInput, resolvedConfig(protectedInput))).toBeUndefined();
  });

  it("names a denylist that lacks an entry", () => {
    const config = resolvedConfig(protectedInput);
    const tools = config["tools"] as Record<string, Record<string, unknown>>;
    tools["write_file"] = { ...tools["write_file"], denylist: guards };
    expect(vibeConfigMismatch(protectedInput, config)).toBe(
      `tools.write_file.denylist is ${JSON.stringify(guards)}, phax set ${JSON.stringify([...guards, ...ENTRIES])}`,
    );
  });
});

describe("vibeAcceptEditsOverridePath", () => {
  it("is under VIBE_HOME when it is set, else under <home>/.vibe", () => {
    expect(vibeAcceptEditsOverridePath({ VIBE_HOME: "/v" }, "/home/me")).toBe(
      "/v/agents/accept-edits.toml",
    );
    expect(vibeAcceptEditsOverridePath({ VIBE_HOME: "" }, "/home/me")).toBe(
      "/home/me/.vibe/agents/accept-edits.toml",
    );
    expect(vibeAcceptEditsOverridePath({}, "")).toBeNull();
  });
});

describe("buildSealedVibeFlags", () => {
  it("disables every tool, with the cwd, no add-dir and no VIBE_TOOLS", () => {
    expect(buildSealedVibeFlags("/work/tree")).toEqual({
      agent: ["--agent", "accept-edits", "--disabled-tools", "*"],
      scope: ["--workdir", "/work/tree"],
      env: { VIBE_OUTSIDE_WORKDIR: "deny", VIBE_BYPASS_TOOL_PERMISSIONS: "false" },
    });
  });
});

describe("buildVibeFlags — unsafe", () => {
  it("runs auto-approve with --trust in the worktree and adds no variables", () => {
    const flags = buildVibeFlags({ security: unsafePolicy, cwd: "/work/tree", agentCommands: [] });
    expect(flags).toEqual({
      agent: ["--agent", "auto-approve"],
      scope: ["--trust", "--workdir", "/work/tree"],
      env: {},
    });
  });

  it("runs the provider entry's agent when one is given", () => {
    const flags = buildVibeFlags({
      security: unsafePolicy,
      cwd: "/work/tree",
      agentCommands: [],
      unsafeAgent: "mine",
    });
    expect(flags.agent).toEqual(["--agent", "mine"]);
  });
});
