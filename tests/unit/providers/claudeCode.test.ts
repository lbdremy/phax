import { describe, expect, it } from "vitest";
import {
  buildArgs,
  buildCompletionArgs,
  gateCommandAllowRules,
} from "../../../src/infra/providers/claudeCode.js";
import { buildSkillEditGrantSettings } from "../../../src/infra/providers/claudeSkillEditSettings.js";
import { SecurityEnforcementError } from "../../../src/domain/errors.js";
import type { AgentRunOptions, CompletionOptions } from "../../../src/ports/backend.js";
import type { SecurityPolicy } from "../../../src/domain/security/types.js";

const unsafePolicy: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open" },
  mcp: { mode: "provider-default", allow: [] },
  agentCommands: [],
  failClosed: false,
};

const securePolicy: SecurityPolicy = {
  mode: "secure",
  filesystem: {
    allowRead: ["/tmp/work", "/home/me/.phax"],
    allowWrite: ["/tmp/work", "/home/me/.phax"],
  },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
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

  it("allowlists agentCommands (config ∪ gates) as sandboxed Bash instead of a blanket deny", () => {
    const args = buildArgs({
      ...baseOptions(securePolicy),
      agentCommands: ["pnpm format:check", "pnpm typecheck", "pnpm test"],
    });
    expect(args).not.toContain("--disallowed-tools");
    const idx = args.indexOf("--allowedTools");
    expect(idx).toBeGreaterThanOrEqual(0);
    // Exact commands only — `pnpm format:check` is NOT widened to `pnpm format`.
    expect(args[idx + 1]).toBe(
      "Bash(pnpm format:check:*),Bash(pnpm typecheck:*),Bash(pnpm test:*)",
    );
  });

  it("allowlists an explicit non-gate command (config-only) via the same Bash prefix rule", () => {
    const args = buildArgs({
      ...baseOptions(securePolicy),
      agentCommands: ["deno fmt"],
    });
    expect(args).not.toContain("--disallowed-tools");
    const idx = args.indexOf("--allowedTools");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("Bash(deno fmt:*)");
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

describe("buildArgs — skill edit grants", () => {
  const grants = [".claude/skills/foo/SKILL.md", ".claude/skills/new/SKILL.md"];

  it("secure mode with grants appends exactly one --settings with the PermissionRequest hook", () => {
    const args = buildArgs({ ...baseOptions(securePolicy), skillEditGrants: grants });
    const indexes = args.reduce<number[]>((acc, v, i) => {
      if (v === "--settings") acc.push(i);
      return acc;
    }, []);
    expect(indexes).toHaveLength(1);
    const settings = JSON.parse(args[(indexes[0] ?? -1) + 1] ?? "");
    expect(settings).toEqual(buildSkillEditGrantSettings("/tmp/work", grants));
    const handlers = settings.hooks.PermissionRequest[0].hooks;
    expect(handlers).toHaveLength(6);
    expect(handlers[0].if).toBe("Edit(//tmp/work/.claude/skills/foo/SKILL.md)");
  });

  it("secure mode with [] produces the same argv as before, with no --settings", () => {
    const args = buildArgs({ ...baseOptions(securePolicy), skillEditGrants: [] });
    expect(args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--add-dir",
      "/home/me/.phax",
      "--disallowed-tools",
      "Bash",
      "--strict-mcp-config",
      "--model",
      "claude-sonnet-4-6",
      "--effort",
      "high",
    ]);
    expect(args).toEqual(buildArgs(baseOptions(securePolicy)));
  });

  it("unsafe mode ignores grants", () => {
    const args = buildArgs({ ...baseOptions(unsafePolicy), skillEditGrants: grants });
    expect(args).not.toContain("--settings");
    expect(args).toEqual(buildArgs(baseOptions(unsafePolicy)));
  });

  it("absent skillEditGrants (review, headless authoring) produces no --settings", () => {
    const args = buildArgs(baseOptions(securePolicy));
    expect(args).not.toContain("--settings");
  });

  it("keeps --resume after --settings on resume invocations", () => {
    const args = buildArgs(
      { ...baseOptions(securePolicy), skillEditGrants: grants },
      "session-abc",
    );
    expect(args).toContain("--settings");
    expect(args.slice(-2)).toEqual(["--resume", "session-abc"]);
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

const completionOptions: CompletionOptions = {
  provider: "claude-code",
  model: "claude-sonnet-4-6",
  effort: "high",
  cwd: "/tmp/phax-extract-abc123",
};

describe("buildCompletionArgs — sealed completion", () => {
  it("emits --permission-mode default (not bypassPermissions, not acceptEdits)", () => {
    const args = buildCompletionArgs(completionOptions);
    expect(args).not.toContain("bypassPermissions");
    expect(args).not.toContain("acceptEdits");
    const idx = args.indexOf("--permission-mode");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("default");
  });

  it("emits an empty --allowedTools (nothing explicitly permitted)", () => {
    const args = buildCompletionArgs(completionOptions);
    const idx = args.indexOf("--allowedTools");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("");
  });

  it("emits --disallowed-tools Bash,WebFetch,WebSearch", () => {
    const args = buildCompletionArgs(completionOptions);
    const idx = args.indexOf("--disallowed-tools");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("Bash,WebFetch,WebSearch");
  });

  it("emits --strict-mcp-config with no --mcp-config", () => {
    const args = buildCompletionArgs(completionOptions);
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--mcp-config");
  });

  it("does not emit --add-dir", () => {
    const args = buildCompletionArgs(completionOptions);
    expect(args).not.toContain("--add-dir");
  });

  it("emits --model and --effort from options", () => {
    const args = buildCompletionArgs(completionOptions);
    const modelIdx = args.indexOf("--model");
    expect(modelIdx).toBeGreaterThanOrEqual(0);
    expect(args[modelIdx + 1]).toBe("claude-sonnet-4-6");
    const effortIdx = args.indexOf("--effort");
    expect(effortIdx).toBeGreaterThanOrEqual(0);
    expect(args[effortIdx + 1]).toBe("high");
  });

  it("includes --print --output-format stream-json --verbose", () => {
    const args = buildCompletionArgs(completionOptions);
    expect(args).toContain("--print");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args).toContain("--verbose");
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
