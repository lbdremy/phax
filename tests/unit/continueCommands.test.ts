import { describe, expect, it } from "vitest";
import { policyFromPosture } from "../../src/domain/security/postureToPolicy.js";
import { resolveSecurityPolicy } from "../../src/domain/security/resolvePolicy.js";
import { claudePermissionFlags } from "../../src/domain/session/claudePermissionFlags.js";
import { claudeSessionAdapter } from "../../src/domain/session/claude.js";
import { codexSessionAdapter } from "../../src/domain/session/codex.js";
import { codexModelId } from "../../src/domain/session/codexFlags.js";
import { mistralSessionAdapter } from "../../src/domain/session/mistral.js";
import type {
  StopCommand,
  StopCommandResult,
  StopPosture,
} from "../../src/domain/session/types.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import type { SecurityPosture } from "../../src/schemas/securityPosture.js";

const WORKTREE = "/Users/ada/.phax/worktrees/invoice-export/phase-03";
const STATE_ROOT = "/Users/ada/.phax";

const securePosture: SecurityPosture = {
  version: 1,
  mode: "secure",
  provider: "codex-cli",
  sandboxEnabled: true,
  filesystem: { allowRead: [WORKTREE, STATE_ROOT], allowWrite: [WORKTREE, STATE_ROOT] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  downgraded: false,
  marks: [],
  agentCommands: [
    {
      command: "pnpm typecheck",
      source: "gate",
      explicit: false,
      requiredByPlan: true,
      enforcement: "prefix",
      degraded: false,
    },
    {
      command: "pnpm test:unit",
      source: "config",
      explicit: true,
      requiredByPlan: false,
      enforcement: "prefix",
      degraded: false,
    },
  ],
  skillEditGrants: [],
  providerSkippedForSecurity: [],
};

const unsafePosture: SecurityPosture = {
  ...securePosture,
  mode: "unsafe",
  sandboxEnabled: false,
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open" },
  mcp: { mode: "provider-default", allow: [] },
};

const secure = policyFromPosture(securePosture);
const unsafe = policyFromPosture(unsafePosture);

const posture = (policy: SecurityPolicy): StopPosture => ({
  policy,
  agentCommands: policy.agentCommands,
});

function command(result: StopCommandResult): StopCommand {
  if ("unsupported" in result) throw new Error(`unsupported: ${result.unsupported}`);
  return result;
}

describe("policyFromPosture", () => {
  it("round-trips a secure posture into the policy resolveSecurityPolicy builds", () => {
    expect(secure).toEqual(
      resolveSecurityPolicy({
        mode: "secure",
        worktreePath: WORKTREE,
        config: {
          profile: "secure",
          filesystem: { allowRead: [STATE_ROOT], allowWrite: [STATE_ROOT] },
          network: { profile: "provider-only" },
          mcp: { mode: "disabled", allow: [] },
          agentCommands: ["pnpm typecheck", "pnpm test:unit"],
        },
      }),
    );
    expect(secure.failClosed).toBe(true);
    expect(secure.agentCommands).toEqual(["pnpm typecheck", "pnpm test:unit"]);
  });

  it("round-trips an unsafe posture, not fail-closed", () => {
    expect(unsafe).toEqual({
      mode: "unsafe",
      filesystem: { allowRead: [], allowWrite: [] },
      network: { profile: "open" },
      mcp: { mode: "provider-default", allow: [] },
      agentCommands: ["pnpm typecheck", "pnpm test:unit"],
      failClosed: false,
    });
  });
});

describe("claude continue and fresh-start commands", () => {
  const opts = { cwd: WORKTREE, model: "claude-sonnet-5-5", effort: "high" };

  it("continues with the model, the effort and the phase's own permission flags", () => {
    const result = command(
      claudeSessionAdapter.buildContinueCommand({
        ...opts,
        sessionId: "sess-1",
        posture: posture(secure),
      }),
    );
    expect(result.executable).toBe("claude");
    expect(result.cwd).toBe(WORKTREE);
    expect(result.env).toEqual({});
    expect(result.args).toEqual([
      "--resume",
      "sess-1",
      "--model",
      "claude-sonnet-5-5",
      "--effort",
      "high",
      "--permission-mode",
      "acceptEdits",
      "--add-dir",
      STATE_ROOT,
      "--allowedTools",
      "Bash(pnpm typecheck:*),Bash(pnpm test:unit:*)",
      "--strict-mcp-config",
    ]);
  });

  it("carries exactly claudePermissionFlags and never a skill-edit grant", () => {
    const result = command(
      claudeSessionAdapter.buildContinueCommand({
        ...opts,
        sessionId: "sess-1",
        posture: posture(secure),
      }),
    );
    const flags = claudePermissionFlags({
      security: secure,
      cwd: WORKTREE,
      agentCommands: secure.agentCommands,
      grantSettings: undefined,
    });
    expect(result.args.slice(6)).toEqual(flags);
    expect(result.args).not.toContain("--settings");
  });

  it("carries the unsafe flag for an unsafe phase", () => {
    const result = command(
      claudeSessionAdapter.buildContinueCommand({
        ...opts,
        sessionId: "s",
        posture: posture(unsafe),
      }),
    );
    expect(result.args.slice(6)).toEqual(["--permission-mode", "bypassPermissions"]);
  });

  it("adds no permission flag for posture none", () => {
    const result = command(
      claudeSessionAdapter.buildContinueCommand({ ...opts, sessionId: "s", posture: "none" }),
    );
    expect(result.args).toEqual([
      "--resume",
      "s",
      "--model",
      "claude-sonnet-5-5",
      "--effort",
      "high",
    ]);
  });

  it("starts fresh without --resume, ending `-- <prompt>`", () => {
    const result = command(
      claudeSessionAdapter.buildFreshStartCommand({
        ...opts,
        posture: posture(secure),
        prompt: "Read .phax-context/interactive-review.md, then review phase-03 with me.",
      }),
    );
    expect(result.args).not.toContain("--resume");
    expect(result.args.slice(0, 4)).toEqual(["--model", "claude-sonnet-5-5", "--effort", "high"]);
    expect(result.args.slice(-2)).toEqual([
      "--",
      "Read .phax-context/interactive-review.md, then review phase-03 with me.",
    ]);
  });
});

describe("codex continue and fresh-start commands", () => {
  const entry = {
    families: { "openai-gpt": { models: [{ id: "gpt-6-luna" }] } },
  };
  const opts = { cwd: WORKTREE, model: codexModelId(entry, "fallback-model"), effort: "xhigh" };

  it("takes the model from the provider entry, else the resolved model", () => {
    expect(codexModelId(entry, "fallback-model")).toBe("gpt-6-luna");
    expect(codexModelId({}, "fallback-model")).toBe("fallback-model");
    expect(codexModelId({ families: { "openai-gpt": { models: [] } } }, "m")).toBe("m");
  });

  it("continues with the model, the clamped effort and the sandbox flags with on-request approvals", () => {
    const result = command(
      codexSessionAdapter.buildContinueCommand({
        ...opts,
        sessionId: "019a2f6e",
        posture: posture(secure),
      }),
    );
    expect(result.executable).toBe("codex");
    expect(result.cwd).toBe(WORKTREE);
    expect(result.env).toEqual({});
    expect(result.args).toEqual([
      "resume",
      "019a2f6e",
      "-m",
      "gpt-6-luna",
      "-c",
      'model_reasoning_effort="high"',
      "-c",
      'sandbox_mode="workspace-write"',
      "-c",
      'approval_policy="on-request"',
      "-c",
      `sandbox_workspace_write.writable_roots=${JSON.stringify([WORKTREE, STATE_ROOT])}`,
      "-c",
      "sandbox_workspace_write.network_access=false",
    ]);
  });

  it("opens the network when the profile is not provider-only", () => {
    const open = { ...secure, network: { profile: "open" as const } };
    const result = command(
      codexSessionAdapter.buildContinueCommand({ ...opts, sessionId: "s", posture: posture(open) }),
    );
    expect(result.args).toContain("sandbox_workspace_write.network_access=true");
  });

  it("keeps the unsafe flag for an unsafe phase", () => {
    const result = command(
      codexSessionAdapter.buildContinueCommand({
        ...opts,
        sessionId: "s",
        posture: posture(unsafe),
      }),
    );
    expect(result.args.slice(-1)).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
    expect(result.args.join(" ")).not.toContain("approval_policy");
  });

  it("adds no sandbox flag for posture none", () => {
    const result = command(
      codexSessionAdapter.buildContinueCommand({ ...opts, sessionId: "s", posture: "none" }),
    );
    expect(result.args).toEqual([
      "resume",
      "s",
      "-m",
      "gpt-6-luna",
      "-c",
      'model_reasoning_effort="high"',
    ]);
  });

  it("is unsupported for a secure policy with no writable path", () => {
    const result = codexSessionAdapter.buildContinueCommand({
      ...opts,
      sessionId: "s",
      posture: posture({ ...secure, filesystem: { allowRead: [], allowWrite: [] } }),
    });
    expect("unsupported" in result).toBe(true);
  });

  it("starts fresh with the model, the flags and the prompt last", () => {
    const result = command(
      codexSessionAdapter.buildFreshStartCommand({
        ...opts,
        posture: posture(secure),
        prompt: "Read .phax-context/interactive-review.md, then review phase-03 with me.",
      }),
    );
    expect(result.args.slice(0, 4)).toEqual([
      "-m",
      "gpt-6-luna",
      "-c",
      'model_reasoning_effort="high"',
    ]);
    expect(result.args).not.toContain("resume");
    expect(result.args).toContain('approval_policy="on-request"');
    expect(result.args[result.args.length - 1]).toBe(
      "Read .phax-context/interactive-review.md, then review phase-03 with me.",
    );
  });
});

describe("mistral-vibe commands", () => {
  const opts = { cwd: WORKTREE, model: "phax-mistral-medium-3.5-medium", effort: "medium" };

  it("has no continue command: interactive resume is unverified", () => {
    const result = mistralSessionAdapter.buildContinueCommand({
      ...opts,
      sessionId: "v-1",
      posture: posture(secure),
    });
    expect(result).toEqual({ unsupported: expect.stringContaining("vibe --resume <session-id>") });
    expect("unsupported" in result && result.unsupported).toContain("unverified");
  });

  it("starts fresh with the workdir, the extra writable roots, the prompt and the model in the env", () => {
    const result = command(
      mistralSessionAdapter.buildFreshStartCommand({
        ...opts,
        posture: posture(secure),
        prompt: "Read .phax-context/interactive-review.md, then review phase-03 with me.",
      }),
    );
    expect(result).toEqual({
      executable: "vibe",
      args: [
        "--workdir",
        WORKTREE,
        "--add-dir",
        STATE_ROOT,
        "Read .phax-context/interactive-review.md, then review phase-03 with me.",
      ],
      cwd: WORKTREE,
      env: { VIBE_ACTIVE_MODEL: "phax-mistral-medium-3.5-medium" },
    });
  });

  it("names the model variable the provider entry names", () => {
    const result = command(
      mistralSessionAdapter.buildFreshStartCommand({
        ...opts,
        posture: "none",
        prompt: "go",
        modelEnvVar: "MY_VIBE_MODEL",
      }),
    );
    expect(result.args).toEqual(["--workdir", WORKTREE, "go"]);
    expect(result.env).toEqual({ MY_VIBE_MODEL: "phax-mistral-medium-3.5-medium" });
  });

  it("trusts the workdir for an unsafe phase", () => {
    const result = command(
      mistralSessionAdapter.buildFreshStartCommand({
        ...opts,
        posture: posture(unsafe),
        prompt: "go",
      }),
    );
    expect(result.args).toEqual(["--workdir", WORKTREE, "--trust", "go"]);
  });
});
