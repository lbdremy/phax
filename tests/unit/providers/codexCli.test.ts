import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexArgs, buildCodexCompletionArgs } from "../../../src/infra/providers/codexCli.js";
import { SecurityEnforcementError } from "../../../src/domain/errors.js";
import type { AgentRunOptions, CompletionOptions } from "../../../src/ports/backend.js";
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
  it('drops danger-full-access in favor of sandbox_mode="workspace-write"', () => {
    const args = buildCodexArgs(baseEntry, baseOptions(securePolicy));
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    // The `-s/--sandbox` flag is rejected by `codex exec resume`; use the
    // config-override form which both `exec` and `exec resume` accept.
    expect(args).not.toContain("--sandbox");
    expect(args).toContain(`sandbox_mode="workspace-write"`);
  });

  it('sets approval_policy="never" so sandbox denials do not silently escape', () => {
    // `codex exec` has no -a/--ask-for-approval flag (verified live in runbook
    // 04b against 0.136.0); the config-key form is the exec-compatible analog.
    const args = buildCodexArgs(baseEntry, baseOptions(securePolicy));
    expect(args).not.toContain("-a");
    expect(args).toContain(`approval_policy="never"`);
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
    // `codex exec resume` rejects `--sandbox`; the sandbox must be set via the
    // config-override form or the resume exits with code 2.
    expect(args).not.toContain("--sandbox");
    expect(args).toContain(`sandbox_mode="workspace-write"`);
    expect(args).toContain("sandbox_workspace_write.network_access=false");
  });

  it("isolated mode follows the secure branch for type totality (CLI gates it earlier)", () => {
    const args = buildCodexArgs(baseEntry, baseOptions({ ...securePolicy, mode: "isolated" }));
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).toContain(`sandbox_mode="workspace-write"`);
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

const completionOptions = (effort = "medium"): CompletionOptions => ({
  provider: "codex-cli",
  model: "gpt-5.5",
  effort,
  cwd: "/tmp/phax-extract-abc123",
});

describe("buildCodexCompletionArgs — sealed completion", () => {
  it('sets sandbox_mode="read-only" (no filesystem writes allowed)', () => {
    const args = buildCodexCompletionArgs(baseEntry, completionOptions());
    expect(args).toContain(`sandbox_mode="read-only"`);
  });

  it('sets approval_policy="never"', () => {
    const args = buildCodexCompletionArgs(baseEntry, completionOptions());
    expect(args).toContain(`approval_policy="never"`);
  });

  it("seals network via read-only mode without an inert workspace-write override", () => {
    // read-only denies subprocess network outright; the
    // `sandbox_workspace_write.*` table only applies in workspace-write mode, so
    // emitting `network_access=false` here would be a misleading no-op.
    const args = buildCodexCompletionArgs(baseEntry, completionOptions());
    expect(args).toContain(`sandbox_mode="read-only"`);
    expect(args.some((a) => a.startsWith("sandbox_workspace_write.network_access"))).toBe(false);
  });

  it("does not emit --dangerously-bypass-approvals-and-sandbox", () => {
    const args = buildCodexCompletionArgs(baseEntry, completionOptions());
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("does not emit writable_roots", () => {
    const args = buildCodexCompletionArgs(baseEntry, completionOptions());
    expect(args.some((a) => a.startsWith("sandbox_workspace_write.writable_roots="))).toBe(false);
  });

  it("uses exec -C <cwd> (not resume)", () => {
    const args = buildCodexCompletionArgs(baseEntry, completionOptions());
    expect(args.slice(0, 3)).toEqual(["exec", "-C", "/tmp/phax-extract-abc123"]);
  });

  it("includes --json and --skip-git-repo-check", () => {
    const args = buildCodexCompletionArgs(baseEntry, completionOptions());
    expect(args).toContain("--json");
    expect(args).toContain("--skip-git-repo-check");
  });

  it("resolves model from families entry", () => {
    const args = buildCodexCompletionArgs(baseEntry, completionOptions());
    expect(args).toContain("-m");
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-5.5");
  });

  it("maps effort to model_reasoning_effort", () => {
    const args = buildCodexCompletionArgs(baseEntry, completionOptions("high"));
    expect(args).toContain(`model_reasoning_effort="high"`);
  });

  it("falls back to options.model when families entry absent", () => {
    const noFamiliesEntry = { executable: "codex" };
    const args = buildCodexCompletionArgs(noFamiliesEntry, completionOptions());
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-5.5");
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
