import { describe, expect, it } from "vitest";
import { claudeSessionAdapter } from "../../src/domain/session/claude.js";
import { codexSessionAdapter } from "../../src/domain/session/codex.js";
import { mistralSessionAdapter } from "../../src/domain/session/mistral.js";
import { getSessionAdapter } from "../../src/domain/session/index.js";
import type { PhaseAgentBinding } from "../../src/schemas/phaseAgentBinding.js";

const baseBinding: PhaseAgentBinding = {
  version: 1,
  shortName: "test-run",
  runId: "run-abc",
  phaseId: "phase-01",
  phaseIndex: 0,
  phaseName: "Test Phase",
  provider: "claude-code",
  adapter: "claude",
  model: "claude-sonnet-4-6",
  effort: "medium",
  sessionId: "sess-abc123",
  sessionHandle: null,
  worktreePath: "/tmp/worktree",
  cwd: "/tmp/worktree",
  launchedAt: "2026-06-18T00:00:00.000Z",
  lockSource: "routing_at_phase_start",
  status: "running",
};

describe("claudeSessionAdapter", () => {
  it("builds resume invocation with expected executable, args, and cwd", () => {
    const invocation = claudeSessionAdapter.buildResumeInvocation(baseBinding);
    expect(invocation).toEqual({
      executable: "claude",
      args: ["--resume", "sess-abc123"],
      cwd: "/tmp/worktree",
    });
  });

  it("returns unsupported when sessionId is null", () => {
    const binding: PhaseAgentBinding = { ...baseBinding, sessionId: null };
    const invocation = claudeSessionAdapter.buildResumeInvocation(binding);
    expect("unsupported" in invocation).toBe(true);
  });

  it("unsupported message does not mention another provider", () => {
    const binding: PhaseAgentBinding = { ...baseBinding, sessionId: null };
    const invocation = claudeSessionAdapter.buildResumeInvocation(binding);
    if ("unsupported" in invocation) {
      expect(invocation.unsupported).not.toContain("codex");
      expect(invocation.unsupported).not.toContain("mistral");
    }
  });

  it("describe() returns a string mentioning the session id", () => {
    const desc = claudeSessionAdapter.describe(baseBinding);
    expect(desc).toContain("sess-abc123");
  });

  it("describe() returns a string mentioning the worktree path", () => {
    const desc = claudeSessionAdapter.describe(baseBinding);
    expect(desc).toContain("/tmp/worktree");
  });
});

describe("codexSessionAdapter", () => {
  it("always returns unsupported (interactive resume not verified)", () => {
    const binding: PhaseAgentBinding = {
      ...baseBinding,
      provider: "codex-cli",
      adapter: "codex",
    };
    const invocation = codexSessionAdapter.buildResumeInvocation(binding);
    expect("unsupported" in invocation).toBe(true);
  });

  it("unsupported message mentions codex", () => {
    const binding: PhaseAgentBinding = {
      ...baseBinding,
      provider: "codex-cli",
      adapter: "codex",
    };
    const invocation = codexSessionAdapter.buildResumeInvocation(binding);
    if ("unsupported" in invocation) {
      expect(invocation.unsupported.toLowerCase()).toContain("codex");
    }
  });

  it("unsupported message does not mention claude (no fallback)", () => {
    const binding: PhaseAgentBinding = {
      ...baseBinding,
      provider: "codex-cli",
      adapter: "codex",
    };
    const invocation = codexSessionAdapter.buildResumeInvocation(binding);
    if ("unsupported" in invocation) {
      expect(invocation.unsupported.toLowerCase()).not.toContain("claude");
    }
  });

  it("describe() returns a string mentioning codex-cli", () => {
    const binding: PhaseAgentBinding = {
      ...baseBinding,
      provider: "codex-cli",
      adapter: "codex",
    };
    const desc = codexSessionAdapter.describe(binding);
    expect(desc.toLowerCase()).toContain("codex");
  });
});

describe("mistralSessionAdapter", () => {
  it("always returns unsupported (interactive resume not verified)", () => {
    const binding: PhaseAgentBinding = {
      ...baseBinding,
      provider: "mistral-vibe",
      adapter: "mistral",
    };
    const invocation = mistralSessionAdapter.buildResumeInvocation(binding);
    expect("unsupported" in invocation).toBe(true);
  });

  it("unsupported message mentions mistral", () => {
    const binding: PhaseAgentBinding = {
      ...baseBinding,
      provider: "mistral-vibe",
      adapter: "mistral",
    };
    const invocation = mistralSessionAdapter.buildResumeInvocation(binding);
    if ("unsupported" in invocation) {
      expect(invocation.unsupported.toLowerCase()).toContain("mistral");
    }
  });

  it("unsupported message does not mention claude (no fallback)", () => {
    const binding: PhaseAgentBinding = {
      ...baseBinding,
      provider: "mistral-vibe",
      adapter: "mistral",
    };
    const invocation = mistralSessionAdapter.buildResumeInvocation(binding);
    if ("unsupported" in invocation) {
      expect(invocation.unsupported.toLowerCase()).not.toContain("claude");
    }
  });

  it("describe() returns a string mentioning mistral", () => {
    const binding: PhaseAgentBinding = {
      ...baseBinding,
      provider: "mistral-vibe",
      adapter: "mistral",
    };
    const desc = mistralSessionAdapter.describe(binding);
    expect(desc.toLowerCase()).toContain("mistral");
  });
});

describe("getSessionAdapter (registry exhaustiveness)", () => {
  it("returns the claude adapter for claude-code", () => {
    expect(getSessionAdapter("claude-code")).toBe(claudeSessionAdapter);
  });

  it("returns the codex adapter for codex-cli", () => {
    expect(getSessionAdapter("codex-cli")).toBe(codexSessionAdapter);
  });

  it("returns the mistral adapter for mistral-vibe", () => {
    expect(getSessionAdapter("mistral-vibe")).toBe(mistralSessionAdapter);
  });
});
