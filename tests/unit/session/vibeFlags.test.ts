import { describe, expect, it } from "vitest";
import { SecurityEnforcementError } from "../../../src/domain/errors.js";
import type { SecurityPolicy } from "../../../src/domain/security/types.js";
import { buildVibeFlags } from "../../../src/domain/session/vibeFlags.js";

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

  it("sets the three secure variables, bash allowlisted to exactly the agent commands in order", () => {
    const { env } = secureFlags();
    expect(Object.keys(env).toSorted()).toEqual([
      "VIBE_BYPASS_TOOL_PERMISSIONS",
      "VIBE_OUTSIDE_WORKDIR",
      "VIBE_TOOLS",
    ]);
    expect(env["VIBE_OUTSIDE_WORKDIR"]).toBe("deny");
    expect(env["VIBE_BYPASS_TOOL_PERMISSIONS"]).toBe("false");
    expect(JSON.parse(env["VIBE_TOOLS"] ?? "null")).toEqual({
      bash: { permission: "ask", allowlist: AGENT_COMMANDS },
      read_file: { allowlist: [] },
      write_file: { allowlist: [] },
      edit: { allowlist: [] },
      grep: { allowlist: [] },
    });
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
