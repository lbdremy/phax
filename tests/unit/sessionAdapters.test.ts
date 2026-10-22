import { describe, expect, it } from "vitest";
import { buildDecideInvocation, claudeSessionAdapter } from "../../src/domain/session/claude.js";
import { claudePermissionFlags } from "../../src/domain/session/claudePermissionFlags.js";
import { resolveReviewSecurityPolicy } from "../../src/domain/security/resolveReviewPolicy.js";
import { buildArgs } from "../../src/infra/providers/claudeCode.js";
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

describe("claudeSessionAdapter.buildPrePromptedInvocation", () => {
  it("new session: includes --session-id, model, effort, and positional prompt", () => {
    const result = claudeSessionAdapter.buildPrePromptedInvocation({
      cwd: "/tmp/wt",
      sessionId: "uuid-123",
      initialPrompt: "Read the prompt file.",
      model: "claude-opus-4-8",
      effort: "high",
    });
    expect(result).toEqual({
      executable: "claude",
      args: [
        "--session-id",
        "uuid-123",
        "--model",
        "claude-opus-4-8",
        "--effort",
        "high",
        "Read the prompt file.",
      ],
      cwd: "/tmp/wt",
    });
  });

  it("new session without model/effort overrides: no --model or --effort flags", () => {
    const result = claudeSessionAdapter.buildPrePromptedInvocation({
      cwd: "/tmp/wt",
      sessionId: "uuid-123",
      initialPrompt: "Read the prompt file.",
    });
    expect(result).toEqual({
      executable: "claude",
      args: ["--session-id", "uuid-123", "Read the prompt file."],
      cwd: "/tmp/wt",
    });
  });

  it("resume (initialPrompt null): uses --resume with no positional prompt", () => {
    const result = claudeSessionAdapter.buildPrePromptedInvocation({
      cwd: "/tmp/wt",
      sessionId: "uuid-456",
      initialPrompt: null,
    });
    expect(result).toEqual({
      executable: "claude",
      args: ["--resume", "uuid-456"],
      cwd: "/tmp/wt",
    });
  });

  it("resume with model override: includes --model after --resume", () => {
    const result = claudeSessionAdapter.buildPrePromptedInvocation({
      cwd: "/tmp/wt",
      sessionId: "uuid-456",
      initialPrompt: null,
      model: "claude-sonnet-4-6",
    });
    expect(result).toEqual({
      executable: "claude",
      args: ["--resume", "uuid-456", "--model", "claude-sonnet-4-6"],
      cwd: "/tmp/wt",
    });
  });
});

describe("codexSessionAdapter.buildPrePromptedInvocation", () => {
  it("new session: returns unsupported refusal", () => {
    const result = codexSessionAdapter.buildPrePromptedInvocation({
      cwd: "/tmp/wt",
      sessionId: "uuid-123",
      initialPrompt: "Read the prompt file.",
    });
    expect("unsupported" in result).toBe(true);
    if ("unsupported" in result) {
      expect(result.unsupported.toLowerCase()).toContain("codex");
    }
  });

  it("resume: returns unsupported refusal", () => {
    const result = codexSessionAdapter.buildPrePromptedInvocation({
      cwd: "/tmp/wt",
      sessionId: "uuid-123",
      initialPrompt: null,
    });
    expect("unsupported" in result).toBe(true);
  });
});

describe("mistralSessionAdapter.buildPrePromptedInvocation", () => {
  it("new session: returns unsupported refusal", () => {
    const result = mistralSessionAdapter.buildPrePromptedInvocation({
      cwd: "/tmp/wt",
      sessionId: "uuid-123",
      initialPrompt: "Read the prompt file.",
    });
    expect("unsupported" in result).toBe(true);
    if ("unsupported" in result) {
      expect(result.unsupported.toLowerCase()).toContain("mistral");
    }
  });

  it("resume: returns unsupported refusal", () => {
    const result = mistralSessionAdapter.buildPrePromptedInvocation({
      cwd: "/tmp/wt",
      sessionId: "uuid-123",
      initialPrompt: null,
    });
    expect("unsupported" in result).toBe(true);
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

describe("interactive resume support", () => {
  it("is verified for claude-code and codex, unverified for mistral-vibe", () => {
    expect(getSessionAdapter("claude-code").interactiveResume).toBe("verified");
    expect(getSessionAdapter("codex-cli").interactiveResume).toBe("verified");
    expect(getSessionAdapter("mistral-vibe").interactiveResume).toBe("unverified");
  });

  it("leaves buildResumeInvocation unsupported for codex and vibe, which `phax enter` still uses", () => {
    const binding: PhaseAgentBinding = { ...baseBinding, provider: "codex-cli", adapter: "codex" };
    expect("unsupported" in codexSessionAdapter.buildResumeInvocation(binding)).toBe(true);
    expect("unsupported" in mistralSessionAdapter.buildResumeInvocation(binding)).toBe(true);
  });
});

describe("buildDecideInvocation", () => {
  const security = resolveReviewSecurityPolicy({
    mode: "secure",
    worktreePath: "/repo",
    config: {
      profile: "secure",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
    },
  });
  const permissionFlags = claudePermissionFlags({
    security,
    cwd: "/repo",
    agentCommands: [],
    grantSettings: undefined,
  });

  it("starts a new session under a known id, the prompt last after --", () => {
    const invocation = buildDecideInvocation({
      cwd: "/repo",
      session: { kind: "new", id: "0b6c-new" },
      model: "claude-opus-5-5",
      effort: "high",
      permissionFlags,
      prompt: "Read .phax-context/decide/2610160900-log-rotation-01/prompt.md and follow it.",
    });
    expect(invocation).toEqual({
      executable: "claude",
      args: [
        "--session-id",
        "0b6c-new",
        "--model",
        "claude-opus-5-5",
        "--effort",
        "high",
        ...permissionFlags,
        "--",
        "Read .phax-context/decide/2610160900-log-rotation-01/prompt.md and follow it.",
      ],
      cwd: "/repo",
    });
  });

  it("resumes the kept authoring session with --resume", () => {
    const invocation = buildDecideInvocation({
      cwd: "/repo",
      session: { kind: "resume", id: "sess-kept" },
      model: "claude-sonnet-5-5",
      effort: "medium",
      permissionFlags,
      prompt: "Read p.md and follow it.",
    });
    expect(invocation.args.slice(0, 6)).toEqual([
      "--resume",
      "sess-kept",
      "--model",
      "claude-sonnet-5-5",
      "--effort",
      "medium",
    ]);
    expect(invocation.args.at(-1)).toBe("Read p.md and follow it.");
  });

  it("carries the same permission flags as the headless argv for the same policy", () => {
    const headless = buildArgs({
      provider: "claude-code",
      model: "claude-opus-5-5",
      effort: "high",
      cwd: "/repo",
      security,
    });
    // The headless argv: --print … --verbose, the permission flags, then --model.
    expect(permissionFlags).toEqual(headless.slice(4, headless.indexOf("--model")));
    expect(permissionFlags).toEqual([
      "--permission-mode",
      "acceptEdits",
      "--add-dir",
      "/repo/.phax-context",
      "--disallowed-tools",
      "Bash",
      "--strict-mcp-config",
    ]);
  });
});
