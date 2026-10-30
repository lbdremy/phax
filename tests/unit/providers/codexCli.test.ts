import { Effect, Either } from "effect";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCodexArgs,
  buildCodexCompletionArgs,
  runCodexAgent,
  runCodexCompletion,
} from "../../../src/infra/providers/codexCli.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../../helpers/fakeProviderCli.js";
import { SecurityEnforcementError } from "../../../src/domain/errors.js";
import type { AgentRunOptions, CompletionOptions } from "../../../src/ports/backend.js";
import type { SecurityPolicy } from "../../../src/domain/security/types.js";
import { readCodexOutcome } from "../../../src/domain/session/outcome.js";

const baseEntry = {
  enabled: true,
  executable: "codex",
  families: {
    "openai-gpt": {
      models: [{ id: "gpt-5.5", efforts: ["low", "medium", "high", "xhigh"], status: "active" }],
    },
  },
} as const;

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const sampleLines = readFileSync(join(fixtureDir, "codex-exec-sample.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0);

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
      network: { profile: "dev-allowlist" },
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

const exited0 = { kind: "exited", code: 0 } as const;

describe("readCodexOutcome on the captured codex --json sample", () => {
  it("answers with the thread id and the agent message", () => {
    expect(readCodexOutcome({ lines: sampleLines, stderr: "", end: exited0 })).toEqual({
      kind: "answer",
      provider: "codex-cli",
      text: "ok",
      structured: null,
      sessionId: "019e8fb5-be1b-7040-b45a-150db63ddff2",
    });
  });

  it("answers with the last agent message when several are emitted", () => {
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
      JSON.stringify({ type: "turn.completed" }),
    ];
    const outcome = readCodexOutcome({ lines, stderr: "", end: exited0 });
    expect(outcome.kind === "answer" ? outcome.text : outcome).toBe("last");
  });

  it("fails a completed turn whose only completed item is not an agent message", () => {
    const lines = [
      JSON.stringify({ type: "thread.started", thread_id: "tid-x" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "i", type: "reasoning", text: "should-be-ignored" },
      }),
      JSON.stringify({ type: "turn.completed" }),
    ];
    const outcome = readCodexOutcome({ lines, stderr: "", end: exited0 });
    expect(outcome.kind === "failure" ? outcome.failure.kind : outcome).toBe("provider-error");
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
    const noFamiliesEntry = { enabled: true, executable: "codex" };
    const args = buildCodexCompletionArgs(noFamiliesEntry, completionOptions());
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-5.5");
  });
});

describe("the answer schema flag", () => {
  const schemaPath = "/tmp/phax-answer-schema-abc/answer.schema.json";

  it("sits after --json on exec", () => {
    const args = buildCodexArgs(baseEntry, baseOptions(unsafePolicy), undefined, schemaPath);
    expect(args.slice(0, 6)).toEqual([
      "exec",
      "-C",
      "/tmp/work",
      "--json",
      "--output-schema",
      schemaPath,
    ]);
  });

  it("sits after --json on exec resume", () => {
    const args = buildCodexArgs(baseEntry, baseOptions(unsafePolicy), "thread-1", schemaPath);
    expect(args.slice(0, 5)).toEqual(["exec", "resume", "thread-1", "--json", "--output-schema"]);
    expect(args[5]).toBe(schemaPath);
  });

  it("sits after --json on a completion", () => {
    const args = buildCodexCompletionArgs(baseEntry, completionOptions(), schemaPath);
    expect(args.slice(3, 6)).toEqual(["--json", "--output-schema", schemaPath]);
  });

  it("is absent without a schema", () => {
    expect(buildCodexArgs(baseEntry, baseOptions(unsafePolicy))).not.toContain("--output-schema");
    expect(buildCodexArgs(baseEntry, baseOptions(unsafePolicy), "thread-1")).not.toContain(
      "--output-schema",
    );
    expect(buildCodexCompletionArgs(baseEntry, completionOptions())).not.toContain(
      "--output-schema",
    );
  });
});

describe("the answer schema file", () => {
  let root: string;
  let cli: FakeProviderCli;
  const SESSION = "019a2f6e-0000-4000-8000-0000000000bb";
  const schema = { type: "object", properties: { answer: { type: "string" } } };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "phax-codex-schema-")));
    cli = makeFakeProviderCli(join(root, "cli"));
    vi.stubEnv("PHAX_FAKE_CLI_LOG", cli.env["PHAX_FAKE_CLI_LOG"] ?? "");
    vi.stubEnv("PHAX_FAKE_CLI_SCRIPT", cli.env["PHAX_FAKE_CLI_SCRIPT"] ?? "");
    vi.stubEnv("HOME", cli.env["HOME"] ?? "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  const entry = () => ({ ...baseEntry, executable: cli.codexPath });
  const options = (): AgentRunOptions => ({
    ...baseOptions(unsafePolicy),
    cwd: root,
    answerSchema: { call: "decide-verdicts", schema },
  });
  const schemaPathOf = (index: number): string => {
    const argv = cli.invocations()[index]?.argv ?? [];
    return argv[argv.indexOf("--output-schema") + 1] ?? "";
  };

  it("holds the schema while codex runs and is gone after a success", async () => {
    cli.setScript({ sessionId: SESSION, finalText: "{}" });
    await Effect.runPromise(runCodexAgent("ask", options(), entry()));

    const path = schemaPathOf(0);
    expect(basename(path)).toBe("answer.schema.json");
    expect(basename(dirname(path))).toMatch(/^phax-answer-schema-/);
    expect(JSON.parse(cli.invocations()[0]?.outputSchema ?? "null")).toEqual(schema);
    expect(existsSync(dirname(path))).toBe(false);
  });

  it("is gone after a resume, a completion and a session that failed", async () => {
    cli.setScripts([
      { sessionId: SESSION, finalText: "{}" },
      { sessionId: SESSION, finalText: "{}" },
      { sessionId: SESSION, finalText: "", exitCode: 1, stderr: "boom" },
    ]);
    await Effect.runPromise(runCodexAgent("ask", options(), entry(), SESSION));
    await Effect.runPromise(
      runCodexCompletion(
        "ask",
        {
          provider: "codex-cli",
          model: "gpt-5.5",
          effort: "medium",
          cwd: root,
          answerSchema: { call: "plan-extraction", schema },
        },
        entry(),
      ),
    );
    const failed = await Effect.runPromise(Effect.either(runCodexAgent("ask", options(), entry())));
    expect(Either.isLeft(failed)).toBe(true);

    const invocations = cli.invocations();
    expect(invocations[0]?.argv.slice(0, 3)).toEqual(["exec", "resume", SESSION]);
    for (const [index, invocation] of invocations.entries()) {
      expect(JSON.parse(invocation.outputSchema ?? "null")).toEqual(schema);
      expect(existsSync(dirname(schemaPathOf(index)))).toBe(false);
    }
  });

  it("is never written for a call without an answerSchema", async () => {
    cli.setScript({ sessionId: SESSION, finalText: "{}" });
    await Effect.runPromise(
      runCodexAgent("ask", { ...options(), answerSchema: undefined }, entry()),
    );
    expect(cli.invocations()[0]?.argv).not.toContain("--output-schema");
    expect(cli.invocations()[0]?.outputSchema).toBeUndefined();
  });
});

describe("readCodexOutcome on a turn.failed exiting 0", () => {
  it("fails with the turn's own message", () => {
    const lines = [
      JSON.stringify({ type: "thread.started", thread_id: "tid-err" }),
      JSON.stringify({ type: "error", message: "boom" }),
      JSON.stringify({ type: "turn.failed", error: { message: "boom" } }),
    ];
    expect(readCodexOutcome({ lines, stderr: "", end: exited0 })).toEqual({
      kind: "failure",
      failure: {
        provider: "codex-cli",
        kind: "provider-error",
        message: "boom",
        sessionId: "tid-err",
        resetAt: null,
      },
    });
  });
});
