import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexArgs } from "../../../src/infra/providers/codexCli.js";
import { SecurityEnforcementError } from "../../../src/domain/errors.js";
import type { AgentRunOptions } from "../../../src/ports/backend.js";
import type { SecurityPolicy } from "../../../src/domain/security/types.js";
import {
  findCodexResultEvent,
  hasCodexErroredResultEvent,
} from "../../../src/schemas/codexOutput.js";

const baseEntry = {
  executable: "codex",
  families: { "openai-gpt": { model: "gpt-5.5" } },
};

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const sampleLines = readFileSync(join(fixtureDir, "codex-exec-sample.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0);

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
  network: { profile: "provider-only", allowDomains: ["api.openai.com"] },
  mcp: { mode: "disabled", allow: [] },
  failClosed: true,
};

const baseOptions = (security: SecurityPolicy, effort = "medium"): AgentRunOptions => ({
  provider: "codex-cli",
  model: "gpt-5.5",
  effort,
  cwd: "/tmp/work",
  security,
});

describe("buildCodexArgs — unsafe mode", () => {
  it("emits the host-unrestricted danger-full-access vector", () => {
    const args = buildCodexArgs(baseEntry, baseOptions(unsafePolicy));
    expect(args).toEqual([
      "exec",
      "-C",
      "/tmp/work",
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-m",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="medium"',
    ]);
  });

  it("emits `codex exec resume <id>` for resume invocations (no -C) preserving the unsafe vector", () => {
    const args = buildCodexArgs(baseEntry, baseOptions(unsafePolicy), "session-abc-123");
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "session-abc-123"]);
    expect(args).not.toContain("-C");
    expect(args).toContain("--json");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).toContain('model_reasoning_effort="medium"');
  });

  it("maps openai-gpt effort levels to codex reasoning effort", () => {
    const effortValue = (effort: string): string => {
      const args = buildCodexArgs(baseEntry, baseOptions(unsafePolicy, effort));
      const idx = args.indexOf("-c");
      return args[idx + 1] ?? "";
    };
    expect(effortValue("low")).toBe('model_reasoning_effort="low"');
    expect(effortValue("medium")).toBe('model_reasoning_effort="medium"');
    expect(effortValue("high")).toBe('model_reasoning_effort="high"');
    // xhigh is not accepted by codex; clamp to high
    expect(effortValue("xhigh")).toBe('model_reasoning_effort="high"');
    // legacy synonyms
    expect(effortValue("off")).toBe('model_reasoning_effort="low"');
    expect(effortValue("max")).toBe('model_reasoning_effort="high"');
  });
});

describe("buildCodexArgs — secure mode", () => {
  it("drops danger-full-access in favor of --sandbox workspace-write", () => {
    const args = buildCodexArgs(baseEntry, baseOptions(securePolicy));
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    const idx = args.indexOf("--sandbox");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("workspace-write");
  });

  it("uses `-a never` so sandbox denials do not silently escape", () => {
    const args = buildCodexArgs(baseEntry, baseOptions(securePolicy));
    const idx = args.indexOf("-a");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("never");
  });

  it("sets writable_roots from security.filesystem.allowWrite as a JSON array", () => {
    const args = buildCodexArgs(baseEntry, baseOptions(securePolicy));
    const rootsEntry = args.find((a) => a.startsWith("sandbox_workspace_write.writable_roots="));
    expect(rootsEntry).toBeDefined();
    const json = rootsEntry!.slice("sandbox_workspace_write.writable_roots=".length);
    expect(JSON.parse(json)).toEqual(["/tmp/work", "/home/me/.phax"]);
  });

  it("disables sandbox network when the network profile is provider-only", () => {
    const args = buildCodexArgs(baseEntry, baseOptions(securePolicy));
    expect(args).toContain("sandbox_workspace_write.network_access=false");
  });

  it("enables sandbox network when the network profile is not provider-only", () => {
    const policy: SecurityPolicy = {
      ...securePolicy,
      network: { profile: "dev-allowlist", allowDomains: ["api.openai.com", "registry.npmjs.org"] },
    };
    const args = buildCodexArgs(baseEntry, baseOptions(policy));
    expect(args).toContain("sandbox_workspace_write.network_access=true");
  });

  it("preserves the model and reasoning-effort config", () => {
    const args = buildCodexArgs(baseEntry, baseOptions(securePolicy, "high"));
    expect(args).toContain("-m");
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-5.5");
    expect(args).toContain('model_reasoning_effort="high"');
  });

  it("emits `codex exec resume <id>` for resume invocations while keeping the secure vector", () => {
    const args = buildCodexArgs(baseEntry, baseOptions(securePolicy), "session-xyz");
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "session-xyz"]);
    expect(args).not.toContain("-C");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    const idx = args.indexOf("--sandbox");
    expect(args[idx + 1]).toBe("workspace-write");
    expect(args).toContain("sandbox_workspace_write.network_access=false");
  });

  it("isolated mode follows the secure branch for type totality (CLI gates it earlier)", () => {
    const args = buildCodexArgs(baseEntry, baseOptions({ ...securePolicy, mode: "isolated" }));
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    const idx = args.indexOf("--sandbox");
    expect(args[idx + 1]).toBe("workspace-write");
  });
});

describe("buildCodexArgs — secure mode fail-closed", () => {
  it("throws SecurityEnforcementError when secure policy has no writable paths", () => {
    const impossiblePolicy: SecurityPolicy = {
      ...securePolicy,
      filesystem: { allowRead: [], allowWrite: [] },
    };
    try {
      buildCodexArgs(baseEntry, baseOptions(impossiblePolicy));
      throw new Error("expected buildCodexArgs to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SecurityEnforcementError);
      const e = err as SecurityEnforcementError;
      expect(e.provider).toBe("codex-cli");
      expect(e.mode).toBe("secure");
      expect(e.message).toMatch(/danger-full-access/i);
    }
  });
});

describe("findCodexResultEvent", () => {
  it("extracts sessionId and finalText from the captured codex --json sample", () => {
    const found = findCodexResultEvent(sampleLines);
    expect(found).toEqual({
      sessionId: "019e8fb5-be1b-7040-b45a-150db63ddff2",
      finalText: "ok",
    });
  });

  it("returns the last agent_message text when multiple item.completed events exist", () => {
    const lines = [
      JSON.stringify({ type: "thread.started", thread_id: "tid-1" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: "first" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: "last" },
      }),
    ];
    expect(findCodexResultEvent(lines)?.finalText).toBe("last");
  });

  it("returns undefined when no thread.started event is present", () => {
    expect(findCodexResultEvent([])).toBeUndefined();
    expect(findCodexResultEvent(['{"type":"turn.started"}'])).toBeUndefined();
    expect(findCodexResultEvent(["not json"])).toBeUndefined();
  });

  it("returns sessionId with empty finalText when no agent_message item is emitted", () => {
    const found = findCodexResultEvent([
      JSON.stringify({ type: "thread.started", thread_id: "tid-only" }),
    ]);
    expect(found).toEqual({ sessionId: "tid-only", finalText: "" });
  });

  it("ignores non-agent-message item.completed events", () => {
    const lines = [
      JSON.stringify({ type: "thread.started", thread_id: "tid-x" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "i", type: "reasoning", text: "should-be-ignored" },
      }),
    ];
    expect(findCodexResultEvent(lines)).toEqual({ sessionId: "tid-x", finalText: "" });
  });
});

describe("hasCodexErroredResultEvent", () => {
  it("returns true on a turn.failed event (codex emits this with exit 0)", () => {
    const errorLines = [
      JSON.stringify({ type: "thread.started", thread_id: "tid-err" }),
      JSON.stringify({ type: "error", message: "boom" }),
      JSON.stringify({ type: "turn.failed", error: { message: "boom" } }),
    ];
    expect(hasCodexErroredResultEvent(errorLines)).toBe(true);
  });

  it("returns false for the happy-path captured sample", () => {
    expect(hasCodexErroredResultEvent(sampleLines)).toBe(false);
  });

  it("returns false for an empty line array", () => {
    expect(hasCodexErroredResultEvent([])).toBe(false);
  });
});
