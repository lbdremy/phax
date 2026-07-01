import { Effect, Either } from "effect";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentRunOptions,
  AgentRunResult,
  CompletionOptions,
  CompletionResult,
} from "../../ports/backend.js";
import { FsError } from "../../ports/fs.js";
import {
  AgentInvocationError,
  AgentSessionIdMissingError,
  RateLimitError,
  SecurityEnforcementError,
  UsageLimitError,
} from "../../domain/errors.js";
import { decodeClaudeSessionId } from "../../domain/branded.js";
import type { SecurityPolicy } from "../../domain/security/types.js";
import {
  classifyRateLimit,
  findResultEvent,
  hasErroredResultEvent,
  type RateLimitClassification,
} from "../../schemas/claudeOutput.js";
import { persistSessionId } from "./sessionWriter.js";
import { writeAgentErrorLog } from "./agentErrorLog.js";
import { buildProtectedPathHookSettings } from "./protectedPathHookSettings.js";

function wrapFsError(err: unknown): FsError {
  return new FsError({
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  });
}

interface SpawnResult {
  readonly lines: string[];
  readonly exitCode: number;
  readonly stderr: string;
}

function spawnClaude(
  args: readonly string[],
  prompt: string,
  outputJsonlPath: string | undefined,
  cwd: string | undefined,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let stderrBuf = "";

    let writeStream: ReturnType<typeof createWriteStream> | undefined;
    if (outputJsonlPath) {
      mkdir(dirname(outputJsonlPath), { recursive: true }).catch(() => undefined);
      writeStream = createWriteStream(outputJsonlPath, { flags: "w" });
    }

    const proc = spawn("claude", [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      ...(cwd !== undefined ? { cwd } : {}),
    });

    proc.stdin.write(prompt, "utf8");
    proc.stdin.end();

    let stdoutBuf = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      writeStream?.write(text);
      stdoutBuf += text;
      const parts = stdoutBuf.split("\n");
      stdoutBuf = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim()) lines.push(line);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });

    proc.on("close", (code) => {
      if (stdoutBuf.trim()) lines.push(stdoutBuf);
      writeStream?.end();
      resolve({ lines, exitCode: code ?? 1, stderr: stderrBuf });
    });

    proc.on("error", (err) => {
      writeStream?.end();
      reject(err);
    });
  });
}

// Centralized secure-mode Claude flag set. Runbook 04b will validate which of
// these the installed `claude` CLI actually enforces; corrections feed back
// here. Today's surface:
//   --permission-mode acceptEdits  (drops bypassPermissions; PHAX no longer
//                              hands the agent blanket host access. acceptEdits
//                              — NOT default — is required for headless runs:
//                              under `default` the --print session has no
//                              approver, so even in-worktree Write/Edit auto-
//                              deny and the agent cannot edit its own code.
//                              acceptEdits auto-approves edits *within* the
//                              working dirs (cwd + --add-dir) while still
//                              denying reads/writes outside them. Verified live
//                              in runbook 04b against claude 2.1.162.)
//   --add-dir <path>           (one per writable path outside cwd; cwd is
//                              implicit, so worktree pass-through happens via
//                              the spawn cwd)
//   --allowedTools Bash(...)   (one prefix rule per frozen agentCommand; the
//                              set is config ∪ gate commands, computed before
//                              the agent spawns and recorded in security.json.
//                              Under acceptEdits the headless --print session
//                              has no approver, so any Bash not matched here
//                              auto-denies. When the frozen set is empty we
//                              fall back to --disallowed-tools Bash.)
//   --disallowed-tools Bash    (full shell deny — only when there are no gate
//                              commands to allowlist)
//   --strict-mcp-config        (no MCP servers loaded unless explicitly given
//                              via --mcp-config; satisfies mcp.mode "disabled"
//                              and constrains "allowlist")
//   --mcp-config <path>...     (one per file when mcp.mode === "allowlist")
//
// Network: there is no native --allowed-domains flag and no domain-allowlist
// concept in the policy (04b confirmed no provider enforces one). The Claude CLI
// reaches api.anthropic.com intrinsically; the agent's own egress tools
// (WebFetch/WebSearch) require approval and Bash is disallowed, so secure runs
// have no unsanctioned network path. Only network.profile is carried.
/**
 * Translate the frozen agentCommands set into Claude `--allowedTools` Bash rules.
 *
 * Each command is allowed by its exact token prefix using Claude's
 * `Bash(<prefix>:*)` wildcard, which matches the command itself plus any
 * trailing arguments. The prefix is the full normalized command — we do NOT
 * widen it to a script "family": a `pnpm format:check` entry allows
 * `pnpm format:check`, not `pnpm format`. This keeps the grant minimal;
 * commands from both config and gates are handled identically here.
 * Rules are de-duplicated and order-stable.
 */
export function gateCommandAllowRules(commands: readonly string[]): string[] {
  const rules = new Set<string>();
  for (const raw of commands) {
    const prefix = raw.trim().split(/\s+/).filter(Boolean).join(" ");
    if (prefix.length === 0) continue;
    rules.add(`Bash(${prefix}:*)`);
  }
  return [...rules];
}

function buildSecureClaudeFlags(
  security: SecurityPolicy,
  cwd: string,
  agentCommands: readonly string[],
): string[] {
  const addDirs = security.filesystem.allowWrite
    .filter((p) => p !== cwd)
    .flatMap((p) => ["--add-dir", p]);

  const mcpFlags: string[] = [];
  if (security.mcp.mode !== "provider-default") {
    mcpFlags.push("--strict-mcp-config");
  }
  if (security.mcp.mode === "allowlist") {
    for (const path of security.mcp.allow) {
      mcpFlags.push("--mcp-config", path);
    }
  }

  // Allowlist the frozen agentCommands set (config ∪ gates) as sandboxed Bash
  // so the agent can run the commands it needs; everything else stays denied.
  // With no commands, fall back to a full Bash deny (disallowed-tools takes
  // precedence over allowedTools, so the two are mutually exclusive).
  const allowRules = gateCommandAllowRules(agentCommands);
  const shellFlags =
    allowRules.length > 0
      ? ["--allowedTools", allowRules.join(",")]
      : ["--disallowed-tools", "Bash"];

  return ["--permission-mode", "acceptEdits", ...addDirs, ...shellFlags, ...mcpFlags];
}

export function buildArgs(
  options: AgentRunOptions,
  resumeSessionId?: string,
  settingsFilePath?: string,
): string[] {
  // `claude` requires `--verbose` whenever `--print` is paired with
  // `--output-format=stream-json`; without it the CLI exits with code 1.
  const common = ["--print", "--output-format", "stream-json", "--verbose"];

  const modeFlags = (() => {
    if (options.security.mode === "unsafe") {
      // `--permission-mode bypassPermissions` is required for non-interactive
      // runs in host-unrestricted mode: phax owns the worktree it spawns
      // claude in, so prompting for Write/Edit approval would deadlock the
      // headless session.
      return ["--permission-mode", "bypassPermissions"];
    }
    // secure / isolated (the CLI gates isolated before reaching here; treat as
    // secure for type totality).
    if (options.security.filesystem.allowWrite.length === 0) {
      throw new SecurityEnforcementError({
        message:
          "Claude Code secure mode requires at least one writable path in the security policy; refusing to run unrestricted.",
        provider: "claude-code",
        mode: options.security.mode,
      });
    }
    return buildSecureClaudeFlags(options.security, options.cwd, options.agentCommands ?? []);
  })();

  const settingsFlags = settingsFilePath !== undefined ? ["--settings", settingsFilePath] : [];

  const args = [
    ...common,
    ...modeFlags,
    ...settingsFlags,
    "--model",
    options.model,
    "--effort",
    options.effort,
  ];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  return args;
}

/** Build a typed rate-limit / usage-limit error from a classification. */
function rateLimitErrorFor(
  classification: RateLimitClassification,
): RateLimitError | UsageLimitError {
  const fields = {
    rawMessage: classification.rawMessage,
    resetAt: classification.resetAt,
  };
  return classification.kind === "usage_limit"
    ? new UsageLimitError({
        message: "Claude Code stopped: usage limit reached.",
        ...fields,
      })
    : new RateLimitError({
        message: "Claude Code stopped: rate limit hit.",
        ...fields,
      });
}

/**
 * Build the sealed argument set for a tool-less model completion call.
 *
 * Security guarantees that are intrinsic to this arg set (not configurable):
 *   --permission-mode default  → any tool attempt auto-denies in headless --print
 *   --allowedTools ""          → empty allowlist (nothing explicitly permitted)
 *   --disallowed-tools Bash,WebFetch,WebSearch → explicit deny for high-risk tools
 *   --strict-mcp-config        → no MCP servers loaded
 *   no --add-dir               → no writable paths granted
 */
export function buildCompletionArgs(options: CompletionOptions): string[] {
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "default",
    "--allowedTools",
    "",
    "--disallowed-tools",
    "Bash,WebFetch,WebSearch",
    "--strict-mcp-config",
    "--model",
    options.model,
    "--effort",
    options.effort,
  ];
}

export function runClaudeCompletion(
  prompt: string,
  options: CompletionOptions,
): Effect.Effect<
  CompletionResult,
  AgentInvocationError | RateLimitError | UsageLimitError | FsError
> {
  const args = buildCompletionArgs(options);
  return Effect.gen(function* () {
    const { lines, exitCode, stderr } = yield* Effect.tryPromise({
      try: () => spawnClaude(args, prompt, undefined, options.cwd),
      catch: (err): AgentInvocationError =>
        new AgentInvocationError({
          message: err instanceof Error ? err.message : String(err),
          argv: ["claude", ...args],
        }),
    });

    if (exitCode !== 0 || hasErroredResultEvent(lines)) {
      const classification = classifyRateLimit(stderr, lines);
      if (classification !== undefined) {
        return yield* Effect.fail(rateLimitErrorFor(classification));
      }
    }

    if (exitCode !== 0) {
      return yield* Effect.fail(
        new AgentInvocationError({
          message: `claude exited with code ${exitCode}`,
          exitCode,
          ...(stderr ? { stderr, stderrExcerpt: stderr } : {}),
          argv: ["claude", ...args],
        }),
      );
    }

    const found = findResultEvent(lines);
    if (!found) {
      return yield* Effect.fail(
        new AgentInvocationError({
          message: "No result event found in claude completion output",
          argv: ["claude", ...args],
        }),
      );
    }

    return { finalText: found.finalText };
  });
}

const HOOK_SUBCOMMAND = "__approve-protected-path";
const SETTINGS_FILE_NAME = "claude-protected-approval.settings.json";

/**
 * Write the protected-path hook settings file for a phase and return its
 * absolute path. Returns undefined when there are no approved paths or no
 * phase folder. Uses sync I/O (like writeAgentErrorLog) — never throws.
 */
export function writeProtectedPathSettings(
  phaseFolderPath: string | undefined,
  approvedProtectedPaths: readonly string[] | undefined,
): string | undefined {
  if (!phaseFolderPath || !approvedProtectedPaths || approvedProtectedPaths.length === 0) {
    return undefined;
  }
  try {
    const settingsPath = join(phaseFolderPath, SETTINGS_FILE_NAME);
    const settings = buildProtectedPathHookSettings(
      approvedProtectedPaths,
      `phax ${HOOK_SUBCOMMAND}`,
    );
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    return settingsPath;
  } catch {
    // Never let a settings-write failure mask the underlying agent run.
    return undefined;
  }
}

export function runClaudeAgent(
  prompt: string,
  options: AgentRunOptions,
  resumeSessionId?: string,
): Effect.Effect<
  AgentRunResult,
  | AgentInvocationError
  | AgentSessionIdMissingError
  | RateLimitError
  | UsageLimitError
  | SecurityEnforcementError
  | FsError
> {
  const settingsFilePath = writeProtectedPathSettings(
    options.phaseFolderPath,
    options.approvedProtectedPaths,
  );
  let args: string[];
  try {
    args = buildArgs(options, resumeSessionId, settingsFilePath);
  } catch (err) {
    if (err instanceof SecurityEnforcementError) {
      return Effect.fail(err);
    }
    throw err;
  }
  return Effect.gen(function* () {
    const { lines, exitCode, stderr } = yield* Effect.tryPromise({
      try: () => spawnClaude(args, prompt, options.outputJsonlPath, options.cwd),
      catch: (err): AgentInvocationError => {
        writeAgentErrorLog(options.phaseFolderPath, {
          argv: ["claude", ...args],
          stderr: err instanceof Error ? err.message : String(err),
        });
        return new AgentInvocationError({
          message: err instanceof Error ? err.message : String(err),
          argv: ["claude", ...args],
          phaseFolderPath: options.phaseFolderPath,
        });
      },
    });

    // Reclassify a failure as a rate/usage limit when the output carries one of
    // the known signatures — on a non-zero exit, or on an errored result event.
    if (exitCode !== 0 || hasErroredResultEvent(lines)) {
      const classification = classifyRateLimit(stderr, lines);
      if (classification !== undefined) {
        return yield* Effect.fail(rateLimitErrorFor(classification));
      }
    }

    if (exitCode !== 0) {
      writeAgentErrorLog(options.phaseFolderPath, { argv: ["claude", ...args], exitCode, stderr });
      return yield* Effect.fail(
        new AgentInvocationError({
          message: `claude exited with code ${exitCode}`,
          exitCode,
          ...(stderr ? { stderr, stderrExcerpt: stderr } : {}),
          argv: ["claude", ...args],
          phaseFolderPath: options.phaseFolderPath,
        }),
      );
    }

    const found = findResultEvent(lines);
    if (!found) {
      return yield* Effect.fail(
        new AgentSessionIdMissingError({
          message: "No result event with session_id found in claude output",
          outputPath: options.outputJsonlPath ?? "",
        }),
      );
    }

    const sessionIdResult = decodeClaudeSessionId(found.sessionId);
    if (Either.isLeft(sessionIdResult)) {
      return yield* Effect.fail(
        new AgentSessionIdMissingError({
          message: `Invalid session_id in claude output: "${found.sessionId}"`,
          outputPath: options.outputJsonlPath ?? "",
        }),
      );
    }

    const capturedSessionId = sessionIdResult.right;

    if (options.phaseFolderPath !== undefined) {
      yield* Effect.tryPromise({
        try: () => persistSessionId(capturedSessionId, options.phaseFolderPath as string),
        catch: wrapFsError,
      });
    }

    return {
      sessionId: capturedSessionId,
      outputPath: options.outputJsonlPath ?? "",
      finalText: found.finalText,
    };
  });
}
