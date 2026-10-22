import { describe, expect, it } from "vitest";
import { buildCodexArgs } from "../../src/infra/providers/codexCli.js";
import type { AgentRunOptions } from "../../src/ports/backend.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";

// A read-only turn at a stop runs under codex's read-only sandbox whatever the
// phase's policy: no writable roots, no network override, no unsafe bypass.

const entry = {
  enabled: true,
  executable: "codex",
  families: {
    "openai-gpt": {
      models: [{ id: "gpt-6-luna", efforts: ["low", "medium", "high"], status: "active" }],
    },
  },
} as const;

const worktree = "/example/worktrees/invoice-export/phase-03";

const securePolicy: SecurityPolicy = {
  mode: "secure",
  filesystem: {
    allowRead: [worktree, "/example/home/.phax"],
    allowWrite: [worktree, "/example/home/.phax"],
  },
  network: { profile: "dev-allowlist" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: ["pnpm test"],
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

const readOnly = (security: SecurityPolicy): AgentRunOptions => ({
  provider: "codex-cli",
  model: "gpt-6-luna",
  effort: "medium",
  cwd: worktree,
  security,
  agentCommands: [],
  readOnly: true,
});

const READ_ONLY_TAIL = [
  "--json",
  "--skip-git-repo-check",
  "-c",
  `sandbox_mode="read-only"`,
  "-c",
  `approval_policy="never"`,
  "-m",
  "gpt-6-luna",
  "-c",
  `model_reasoning_effort="medium"`,
];

describe("buildCodexArgs — read-only turn", () => {
  it("runs `exec` under the read-only sandbox with no writable root or network override", () => {
    expect(buildCodexArgs(entry, readOnly(securePolicy))).toEqual([
      "exec",
      "-C",
      worktree,
      ...READ_ONLY_TAIL,
    ]);
  });

  it("runs `exec resume` under the same read-only flags", () => {
    expect(
      buildCodexArgs(entry, readOnly(securePolicy), "019a2f6e-0000-4000-8000-000000000001"),
    ).toEqual(["exec", "resume", "019a2f6e-0000-4000-8000-000000000001", ...READ_ONLY_TAIL]);
  });

  it("drops an unsafe policy's bypass flag", () => {
    const args = buildCodexArgs(entry, readOnly(unsafePolicy));
    expect(args).toEqual(["exec", "-C", worktree, ...READ_ONLY_TAIL]);
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("never names a writable root or the network", () => {
    const args = buildCodexArgs(entry, readOnly(securePolicy)).join(" ");
    expect(args).not.toContain("workspace-write");
    expect(args).not.toContain("writable_roots");
    expect(args).not.toContain("network_access");
  });

  it("leaves a headless turn's argv as the policy builds it", () => {
    const { readOnly: _readOnly, ...headless } = readOnly(securePolicy);
    expect(buildCodexArgs(entry, headless)).toContain(`sandbox_mode="workspace-write"`);
  });
});
