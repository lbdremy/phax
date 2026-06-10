import { describe, expect, it } from "vitest";
import { buildArgs, gateCommandAllowRules } from "../../../src/infra/providers/claudeCode.js";
import { SecurityEnforcementError } from "../../../src/domain/errors.js";
import type { AgentRunOptions } from "../../../src/ports/backend.js";
import type { SecurityPolicy } from "../../../src/domain/security/types.js";

const unsafePolicy: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open", allowDomains: [] },
  mcp: { mode: "provider-default", allow: [] },
  failClosed: false,
};

const securePolicy: SecurityPolicy = {
  mode: "secure",
  filesystem: {
    allowRead: ["/tmp/work", "/home/me/.phax"],
    allowWrite: ["/tmp/work", "/home/me/.phax"],
  },
  network: { profile: "provider-only", allowDomains: ["api.anthropic.com"] },
  mcp: { mode: "disabled", allow: [] },
  failClosed: true,
};

const baseOptions = (security: SecurityPolicy): AgentRunOptions => ({
  provider: "claude-code",
  model: "claude-sonnet-4-6",
  effort: "high",
  cwd: "/tmp/work",
  security,
});

describe("buildArgs — unsafe mode", () => {
  it("emits the host-unrestricted bypassPermissions vector", () => {
    const args = buildArgs(baseOptions(unsafePolicy));
    expect(args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      "--model",
      "claude-sonnet-4-6",
      "--effort",
      "high",
    ]);
  });

  it("appends --resume <id> for resume invocations", () => {
    const args = buildArgs(baseOptions(unsafePolicy), "session-xyz");
    expect(args.slice(-2)).toEqual(["--resume", "session-xyz"]);
    expect(args).toContain("bypassPermissions");
  });
});

describe("buildArgs — secure mode", () => {
  it("drops bypassPermissions in favor of --permission-mode acceptEdits", () => {
    // acceptEdits (not default) is required for headless runs: under `default`
    // the --print session has no approver, so even in-worktree writes auto-deny.
    // Confirmed live in runbook 04b. See buildSecureClaudeFlags.
    const args = buildArgs(baseOptions(securePolicy));
    expect(args).not.toContain("bypassPermissions");
    const idx = args.indexOf("--permission-mode");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("acceptEdits");
  });

  it("adds --add-dir for writable paths outside cwd (worktree implicit via cwd)", () => {
    const args = buildArgs(baseOptions(securePolicy));
    // worktree (/tmp/work) equals cwd — passed via spawn cwd, not --add-dir.
    const addDirIndexes = args.reduce<number[]>((acc, v, i) => {
      if (v === "--add-dir") acc.push(i);
      return acc;
    }, []);
    const addedDirs = addDirIndexes.map((i) => args[i + 1]);
    expect(addedDirs).toEqual(["/home/me/.phax"]);
  });

  it("emits --disallowed-tools Bash when the phase has no gate commands to allowlist", () => {
    const args = buildArgs(baseOptions(securePolicy));
    const idx = args.indexOf("--disallowed-tools");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("Bash");
    expect(args).not.toContain("--allowedTools");
  });

  it("allowlists gate commands as sandboxed Bash instead of a blanket deny", () => {
    const args = buildArgs({
      ...baseOptions(securePolicy),
      gateCommands: ["pnpm format:check", "pnpm typecheck", "pnpm test"],
    });
    expect(args).not.toContain("--disallowed-tools");
    const idx = args.indexOf("--allowedTools");
    expect(idx).toBeGreaterThanOrEqual(0);
    // Exact commands only — `pnpm format:check` is NOT widened to `pnpm format`.
    expect(args[idx + 1]).toBe(
      "Bash(pnpm format:check:*),Bash(pnpm typecheck:*),Bash(pnpm test:*)",
    );
  });

  it("emits --strict-mcp-config when mcp.mode is disabled and no --mcp-config", () => {
    const args = buildArgs(baseOptions(securePolicy));
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--mcp-config");
  });

  it("emits --mcp-config once per allowlisted file when mcp.mode is allowlist", () => {
    const policy: SecurityPolicy = {
      ...securePolicy,
      mcp: { mode: "allowlist", allow: ["/etc/phax/mcp-a.json", "/etc/phax/mcp-b.json"] },
    };
    const args = buildArgs(baseOptions(policy));
    expect(args).toContain("--strict-mcp-config");
    const mcpConfigIndexes = args.reduce<number[]>((acc, v, i) => {
      if (v === "--mcp-config") acc.push(i);
      return acc;
    }, []);
    expect(mcpConfigIndexes.map((i) => args[i + 1])).toEqual([
      "/etc/phax/mcp-a.json",
      "/etc/phax/mcp-b.json",
    ]);
  });

  it("appends --resume <id> for resume invocations and keeps the secure vector", () => {
    const args = buildArgs(baseOptions(securePolicy), "session-abc");
    expect(args.slice(-2)).toEqual(["--resume", "session-abc"]);
    expect(args).not.toContain("bypassPermissions");
    expect(args).toContain("--strict-mcp-config");
  });

  it("isolated mode follows the secure branch for type totality (CLI gates it earlier)", () => {
    const args = buildArgs(baseOptions({ ...securePolicy, mode: "isolated" }));
    expect(args).not.toContain("bypassPermissions");
    expect(args).toContain("--strict-mcp-config");
  });
});

describe("gateCommandAllowRules", () => {
  it("allows each gate command by its exact token prefix (no family widening)", () => {
    expect(gateCommandAllowRules(["pnpm format:check"])).toEqual(["Bash(pnpm format:check:*)"]);
    expect(gateCommandAllowRules(["pnpm test:unit"])).toEqual(["Bash(pnpm test:unit:*)"]);
    expect(gateCommandAllowRules(["tsc --noEmit"])).toEqual(["Bash(tsc --noEmit:*)"]);
  });

  it("normalizes internal whitespace", () => {
    expect(gateCommandAllowRules(["  pnpm   format:check  "])).toEqual([
      "Bash(pnpm format:check:*)",
    ]);
  });

  it("de-duplicates identical commands but keeps distinct siblings", () => {
    expect(gateCommandAllowRules(["pnpm format:check", "pnpm format:check"])).toEqual([
      "Bash(pnpm format:check:*)",
    ]);
    expect(gateCommandAllowRules(["pnpm format:check", "pnpm format"])).toEqual([
      "Bash(pnpm format:check:*)",
      "Bash(pnpm format:*)",
    ]);
  });

  it("returns an empty list for no commands", () => {
    expect(gateCommandAllowRules([])).toEqual([]);
  });
});

describe("buildArgs — secure mode fail-closed", () => {
  it("throws SecurityEnforcementError when secure policy has no writable paths", () => {
    const impossiblePolicy: SecurityPolicy = {
      ...securePolicy,
      filesystem: { allowRead: [], allowWrite: [] },
    };
    try {
      buildArgs(baseOptions(impossiblePolicy));
      throw new Error("expected buildArgs to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SecurityEnforcementError);
      const e = err as SecurityEnforcementError;
      expect(e.provider).toBe("claude-code");
      expect(e.mode).toBe("secure");
      expect(e.message).toMatch(/unrestricted/i);
    }
  });
});
