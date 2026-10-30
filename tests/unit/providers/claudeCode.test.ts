import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildArgs,
  buildCompletionArgs,
  buildProbeArgs,
  runClaudeAgent,
  runClaudeCompletion,
} from "../../../src/infra/providers/claudeCode.js";
import {
  claudeAnswerSchema,
  STRUCTURED_CALLS,
  type StructuredCallsTable,
} from "../../../src/domain/session/structuredCalls.js";
import { answerJsonSchema } from "../../../src/schemas/answerSchemas.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../../helpers/fakeProviderCli.js";
import { PROBE_EFFORT, PROBE_MODEL } from "../../../src/domain/cost/probe.js";
import { gateCommandAllowRules } from "../../../src/domain/session/claudePermissionFlags.js";
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

describe("buildArgs — read-only", () => {
  const readOnlyArgs = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "default",
    "--tools",
    "Read,Grep,Glob",
    "--strict-mcp-config",
    "--model",
    "claude-sonnet-4-6",
    "--effort",
    "high",
    "--resume",
    "session-abc",
  ];

  it("removes the shell and every writing tool under a secure policy", () => {
    const args = buildArgs({ ...baseOptions(securePolicy), readOnly: true }, "session-abc");
    expect(args).toEqual(readOnlyArgs);
    expect(args).not.toContain("acceptEdits");
    expect(args).not.toContain("--add-dir");
  });

  it("is not loosened by an unsafe policy", () => {
    const args = buildArgs({ ...baseOptions(unsafePolicy), readOnly: true }, "session-abc");
    expect(args).toEqual(readOnlyArgs);
    expect(args).not.toContain("bypassPermissions");
  });

  it("takes no skill edit grant", () => {
    const args = buildArgs(
      {
        ...baseOptions(securePolicy),
        readOnly: true,
        skillEditGrants: [".claude/skills/foo/SKILL.md"],
      },
      "session-abc",
    );
    expect(args).toEqual(readOnlyArgs);
  });

  it("adds the shell back for exactly its agent commands, with no writing tool", () => {
    const args = buildArgs({
      ...baseOptions(securePolicy),
      readOnly: true,
      agentCommands: ["phax architecture"],
    });
    expect(args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "default",
      "--tools",
      "Read,Grep,Glob,Bash",
      "--allowedTools",
      "Bash(phax architecture:*)",
      "--strict-mcp-config",
      "--model",
      "claude-sonnet-4-6",
      "--effort",
      "high",
    ]);
    expect(args).not.toContain("acceptEdits");
  });
});

describe("buildArgs — skill edit grants", () => {
  const grants = [".claude/skills/foo/SKILL.md", ".claude/skills/new/SKILL.md"];

  // A root that does not exist is used as given (realpath cannot resolve it).
  const missingRoot = "/phax-test-missing-root/work";

  it("secure mode with grants appends exactly one --settings with the PermissionRequest hook", () => {
    const args = buildArgs({
      ...baseOptions(securePolicy),
      cwd: missingRoot,
      skillEditGrants: grants,
    });
    const indexes = args.reduce<number[]>((acc, v, i) => {
      if (v === "--settings") acc.push(i);
      return acc;
    }, []);
    expect(indexes).toHaveLength(1);
    const settings = JSON.parse(args[(indexes[0] ?? -1) + 1] ?? "");
    expect(settings).toEqual(buildSkillEditGrantSettings(missingRoot, grants));
    const handlers = settings.hooks.PermissionRequest[0].hooks;
    expect(handlers).toHaveLength(6);
    expect(handlers[0].if).toBe("Edit(//phax-test-missing-root/work/.claude/skills/foo/SKILL.md)");
  });

  it("scopes the rules to the symlink-resolved worktree root", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "phax-grant-root-")));
    try {
      const real = join(base, "real");
      const link = join(base, "link");
      mkdirSync(real);
      symlinkSync(real, link);
      const args = buildArgs({ ...baseOptions(securePolicy), cwd: link, skillEditGrants: grants });
      const settings = JSON.parse(args[args.indexOf("--settings") + 1] ?? "");
      expect(settings).toEqual(buildSkillEditGrantSettings(real, grants));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
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

describe("buildProbeArgs — the windows probe", () => {
  const args = buildProbeArgs({ model: PROBE_MODEL, effort: PROBE_EFFORT });

  it("is the sealed completion flag set plus --no-session-persistence", () => {
    expect(args).toEqual([
      ...buildCompletionArgs({
        provider: "claude-code",
        model: "claude-haiku-5-5",
        effort: "low",
        cwd: tmpdir(),
      }),
      "--no-session-persistence",
      "--tools",
      "",
    ]);
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("default");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("");
    expect(args[args.indexOf("--disallowed-tools") + 1]).toBe("Bash,WebFetch,WebSearch");
    expect(args).toContain("--strict-mcp-config");
  });

  it("runs claude-haiku-5-5 at effort low", () => {
    expect(args[args.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
    expect(args[args.indexOf("--effort") + 1]).toBe("low");
  });

  it("grants no tool, no writable path, no MCP config and no turn cap", () => {
    expect(args).not.toContain("--add-dir");
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--max-turns");
    expect(args).not.toContain("bypassPermissions");
    expect(args).not.toContain("acceptEdits");
    expect(args).not.toContain("--resume");
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

// ── Native structured output (--json-schema) ───────────────────────────────

const answerSchema = {
  call: "decide-verdicts",
  schema: answerJsonSchema("spec-document"),
} as const;
const promptTable: StructuredCallsTable = {
  ...STRUCTURED_CALLS,
  "decide-verdicts": { claudeCode: "prompt" },
};
const handedSchema = JSON.stringify(claudeAnswerSchema(answerSchema.schema));
const stampOf = (schema: object): string =>
  (schema as { properties: { $schema: { const: string } } }).properties.$schema.const;

function schemaValue(args: readonly string[]): string | undefined {
  const idx = args.indexOf("--json-schema");
  return idx < 0 ? undefined : args[idx + 1];
}

describe("buildArgs — the answer schema", () => {
  const readOnly = { ...baseOptions(securePolicy), readOnly: true, answerSchema };

  it("hands a new session the minified schema without its $schema property, before --model", () => {
    const args = buildArgs(readOnly);
    expect(schemaValue(args)).toBe(handedSchema);
    expect(args.indexOf("--json-schema")).toBe(args.indexOf("--model") - 2);
    const handed = JSON.parse(schemaValue(args) ?? "{}") as {
      properties: object;
      required: string[];
    };
    expect(Object.keys(handed.properties)).not.toContain("$schema");
    expect(handed.required).not.toContain("$schema");
  });

  it("hands a resume the same schema and still ends on --resume <id>", () => {
    const args = buildArgs(readOnly, "session-abc");
    expect(schemaValue(args)).toBe(handedSchema);
    expect(args.slice(-2)).toEqual(["--resume", "session-abc"]);
  });

  it("hands it to a session that is not read-only too", () => {
    const args = buildArgs({ ...baseOptions(unsafePolicy), answerSchema });
    expect(schemaValue(args)).toBe(handedSchema);
    expect(args.indexOf("--json-schema")).toBeLessThan(args.indexOf("--model"));
  });

  it("hands none without an answerSchema", () => {
    expect(buildArgs(baseOptions(securePolicy))).not.toContain("--json-schema");
    expect(buildArgs({ ...baseOptions(securePolicy), readOnly: true })).not.toContain(
      "--json-schema",
    );
  });

  it("hands none to a call the table puts on the prompt, new session or resume", () => {
    expect(buildArgs(readOnly, undefined, promptTable)).not.toContain("--json-schema");
    expect(buildArgs(readOnly, "session-abc", promptTable)).not.toContain("--json-schema");
  });

  it("leaves the argv otherwise as it was", () => {
    const withSchema = buildArgs(readOnly, "session-abc");
    const without = buildArgs({ ...readOnly, answerSchema: undefined }, "session-abc");
    const flagAt = withSchema.indexOf("--json-schema");
    expect(withSchema.filter((_, i) => i !== flagAt && i !== flagAt + 1)).toEqual(without);
  });
});

describe("buildCompletionArgs — the answer schema", () => {
  const extraction = answerJsonSchema("phax-plan-extraction");
  const options: CompletionOptions = {
    provider: "claude-code",
    model: "claude-sonnet-4-6",
    effort: "high",
    cwd: "/tmp/phax-extract-abc123",
    answerSchema: { call: "plan-extraction", schema: extraction },
  };

  it("hands the minified schema without its $schema property, before --model", () => {
    const args = buildCompletionArgs(options);
    expect(schemaValue(args)).toBe(JSON.stringify(claudeAnswerSchema(extraction)));
    expect(args.indexOf("--json-schema")).toBe(args.indexOf("--model") - 2);
  });

  it("hands none without an answerSchema, to the probe, or on the prompt", () => {
    expect(buildCompletionArgs({ ...options, answerSchema: undefined })).not.toContain(
      "--json-schema",
    );
    expect(buildProbeArgs({ model: PROBE_MODEL, effort: PROBE_EFFORT })).not.toContain(
      "--json-schema",
    );
    const table: StructuredCallsTable = {
      ...STRUCTURED_CALLS,
      "plan-extraction": { claudeCode: "prompt" },
    };
    expect(buildCompletionArgs(options, table)).not.toContain("--json-schema");
  });
});

describe("runClaudeAgent — the prompt and the structured value", () => {
  let root: string;
  let cli: FakeProviderCli;
  const SESSION = "019a2f6e-0000-4000-8000-0000000000aa";
  const LINE = "phax sets the answer's `$schema` itself, so leave it out.";

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "phax-claude-schema-")));
    cli = makeFakeProviderCli(join(root, "cli"));
    for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  const options = (extra: Partial<AgentRunOptions>): AgentRunOptions => ({
    ...baseOptions(securePolicy),
    cwd: root,
    readOnly: true,
    ...extra,
  });

  it("appends the leave-it-out line only when the flag is there, on a new session and a resume", async () => {
    cli.setScript({ sessionId: SESSION, finalText: "{}" });
    await Effect.runPromise(runClaudeAgent("ask", options({ answerSchema })));
    await Effect.runPromise(runClaudeAgent("ask", options({ answerSchema }), SESSION));
    await Effect.runPromise(
      runClaudeAgent("ask", options({ answerSchema }), undefined, promptTable),
    );
    await Effect.runPromise(runClaudeAgent("ask", options({})));

    const prompts = cli.traces().map((trace) => trace.stdin);
    expect(prompts[0]).toBe(`ask\n\n${LINE}\n`);
    expect(prompts[1]).toBe(`ask\n\n${LINE}\n`);
    expect(prompts[2]).toBe("ask");
    expect(prompts[3]).toBe("ask");
  });

  it("returns the structured value with the handed schema's stamp set first", async () => {
    cli.setScript({ sessionId: SESSION, finalText: "", structuredOutput: { title: "x" } });

    const handed = await Effect.runPromise(runClaudeAgent("ask", options({ answerSchema })));
    expect(handed.structured).toEqual({
      value: { $schema: stampOf(answerSchema.schema), title: "x" },
    });
    expect(Object.keys(handed.structured?.value as object)[0]).toBe("$schema");

    const onPrompt = await Effect.runPromise(
      runClaudeAgent("ask", options({ answerSchema }), undefined, promptTable),
    );
    expect(onPrompt.structured).toEqual({ value: { title: "x" } });
  });

  it("appends the line to a completion's prompt and stamps its structured value", async () => {
    cli.setScript({ sessionId: SESSION, finalText: "", structuredOutput: { kind: "complete" } });
    const extraction = answerJsonSchema("phax-plan-extraction");
    const result = await Effect.runPromise(
      runClaudeCompletion("ask", {
        provider: "claude-code",
        model: "claude-sonnet-4-6",
        effort: "high",
        cwd: root,
        answerSchema: { call: "plan-extraction", schema: extraction },
      }),
    );
    expect(cli.traces()[0]?.stdin).toBe(`ask\n\n${LINE}\n`);
    expect(result.structured).toEqual({
      value: { $schema: stampOf(extraction), kind: "complete" },
    });
  });
});
